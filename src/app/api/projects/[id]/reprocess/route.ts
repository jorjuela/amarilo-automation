import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/auth'
import { extractProject } from '@/lib/ai/project-extractor'
import type { TextSource } from '@/lib/ai/project-extractor'

// Re-runs the AI extraction pipeline on a project's stored brief text
// and updates name, city, type, stage, torres, briefData
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const project = await prisma.project.findUnique({
      where: { id },
      include: { torres: true },
    })
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!project.briefRawText || project.briefRawText.trim().length < 50) {
      return NextResponse.json({ error: 'No brief text stored — cannot re-process' }, { status: 400 })
    }

    // Split combined raw text back into sources by separator
    const rawText = project.briefRawText
    const sources: TextSource[] = []
    const parts = rawText.split(/\n=== [^=]+ ===\n/)

    if (parts.length > 1) {
      // Multiple sources stored with separators
      const filenames = [...rawText.matchAll(/=== ([^=]+) ===/g)].map((m) => m[1].trim())
      parts.forEach((text, i) => {
        if (text.trim().length > 30) {
          const filename = filenames[i - 1] || (i === 0 ? 'email-body.txt' : `attachment-${i}.txt`)
          sources.push({ filename, text, isBody: filename.includes('body') })
        }
      })
    } else {
      sources.push({ filename: project.briefFileName || 'brief.txt', text: rawText })
    }

    const extracted = await extractProject(
      sources,
      project.emailSubject || '',
      '',
    )

    // Update project with fresh extraction
    await prisma.project.update({
      where: { id },
      data: {
        name: extracted.projectName || project.name,
        macroProject: extracted.macroProject || project.macroProject,
        city: extracted.city || project.city,
        type: extracted.type,
        stage: extracted.stage,
        monthYear: extracted.monthYear || project.monthYear,
        briefData: JSON.stringify(extracted.campaign),
        parseSource: extracted.parseSource,
        parseConfidence: extracted.confidence,
        needsReview: extracted.confidence === 'low',
        briefParsedAt: new Date(),
      },
    })

    // Replace torres if we got better data
    if (extracted.torres.length > 0 && extracted.confidence !== 'low') {
      await prisma.torre.deleteMany({ where: { projectId: id } })
      await prisma.torre.createMany({
        data: extracted.torres.map((t) => ({
          projectId: id,
          name: t.name,
          areas: JSON.stringify(t.areas || []),
          leadGoal: t.leadGoal || 0,
          budget: t.budget || 0,
          motivo: t.motivo ?? null,
          ageRange: t.ageRange ?? null,
          audience: t.audience ? JSON.stringify(t.audience) : null,
        })),
      })
    }

    return NextResponse.json({
      message: 'OK',
      projectName: extracted.projectName,
      confidence: extracted.confidence,
      parseSource: extracted.parseSource,
    })
  } catch (error) {
    console.error('Reprocess error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
