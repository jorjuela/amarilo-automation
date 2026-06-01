import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateJiraStructure } from '@/lib/jira/generator'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')

  try {
    const structures = await prisma.jiraStructure.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(structures)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch jira structures' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json()

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { torres: true },
    })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projectDTO: any = {
      ...project,
      torres: project.torres.map((t) => ({ ...t, areas: JSON.parse(t.areas) })),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      briefParsedAt: project.briefParsedAt?.toISOString(),
      emailReceivedAt: project.emailReceivedAt?.toISOString(),
    }

    const output = generateJiraStructure(projectDTO)
    return NextResponse.json(output)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
