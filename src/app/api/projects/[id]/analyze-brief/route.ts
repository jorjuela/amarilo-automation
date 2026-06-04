import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/auth'
import { analyzeBrief } from '@/lib/ai/brief-analyzer'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const project = await prisma.project.findUnique({
      where: { id },
      include: { torres: true },
    })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    if (!project.briefRawText || project.briefRawText.length < 100) {
      return NextResponse.json({ error: 'No brief text available to analyze' }, { status: 400 })
    }

    const analysis = await analyzeBrief(project.briefRawText, project.name, project.city)
    return NextResponse.json(analysis)
  } catch (error) {
    console.error('Brief analysis error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
