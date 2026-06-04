import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/auth'
import { analyzeBrief } from '@/lib/ai/brief-analyzer'
import { autoAssignTasks } from '@/lib/traffic/auto-assign'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const body = await req.json().catch(() => ({}))
    const {
      startDate: startDateStr,
      clearExisting = false,
    } = body as { startDate?: string; clearExisting?: boolean }

    const project = await prisma.project.findUnique({
      where: { id },
      include: { torres: true },
    })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    if (!project.briefRawText || project.briefRawText.length < 50) {
      return NextResponse.json({ error: 'No brief text available' }, { status: 400 })
    }

    // Load collaborators from DB (fall back to types constants if empty)
    const collabs = await prisma.collaborator.findMany({ where: { active: true } })
    const copyTeam  = collabs.filter((c) => c.role === 'COPY').map((c) => c.name)
    const graphicTeam = collabs.filter((c) => c.role === 'GRAFICO').map((c) => c.name)

    // Default fallbacks if no collaborators configured
    const finalCopy    = copyTeam.length    > 0 ? copyTeam    : ['Jaime', 'Laura G']
    const finalGraphic = graphicTeam.length > 0 ? graphicTeam : ['Nico', 'Carlos']

    // Analyze brief with Gemini
    const analysis = await analyzeBrief(project.briefRawText, project.name, project.city)

    if (analysis.tasks.length === 0) {
      return NextResponse.json({ message: 'No tasks extracted from brief', assigned: 0 })
    }

    // Determine start date
    const startDate = startDateStr ? new Date(startDateStr) : new Date()

    // Run auto-assignment
    const assigned = autoAssignTasks(analysis.tasks, finalCopy, finalGraphic, startDate)

    // Optionally clear existing AI-generated entries for this project
    if (clearExisting) {
      await prisma.trafficEntry.deleteMany({
        where: { projectId: id, aiGenerated: true },
      })
    }

    // Persist to DB
    const created = await prisma.trafficEntry.createMany({
      data: assigned.map((t) => ({
        projectId: id,
        weekStart: t.weekStart,
        weekEnd:   t.weekEnd,
        weekLabel: t.weekLabel,
        dayOfWeek: t.dayOfWeek,
        date:      t.date,
        campaign:  t.campaign,
        pm:        t.pm,
        requirement: t.requirement,
        numTexts:  t.numTexts,
        copyName:  t.copyName,
        numGraphics: t.numGraphics,
        graphicName: t.graphicName,
        status:    t.status,
        hoursEstimated: t.hoursEstimated,
        aiGenerated: true,
      })),
    })

    return NextResponse.json({
      message: 'OK',
      tasksExtracted: analysis.tasks.length,
      assigned: created.count,
      summary: analysis.summary,
      totalCopyHours: analysis.totalCopyHours,
      totalGraphicHours: analysis.totalGraphicHours,
    })
  } catch (error) {
    console.error('Auto-assign error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
