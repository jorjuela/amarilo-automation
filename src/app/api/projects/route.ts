import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: { torres: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(projects)
  } catch (error) {
    console.error('GET /api/projects error:', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { torres, ...projectData } = body

    const project = await prisma.project.create({
      data: {
        ...projectData,
        torres: torres
          ? {
              create: torres.map((t: {
                name: string; areas: string[]; leadGoal: number;
                budget: number; motivo?: string; ageRange?: string;
                audience?: unknown
              }) => ({
                name: t.name,
                areas: JSON.stringify(t.areas || []),
                leadGoal: t.leadGoal || 0,
                budget: t.budget || 0,
                motivo: t.motivo,
                ageRange: t.ageRange,
                audience: t.audience ? JSON.stringify(t.audience) : null,
              })),
            }
          : undefined,
      },
      include: { torres: true },
    })

    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    console.error('POST /api/projects error:', error)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}
