import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateTrafficExcel } from '@/lib/excel/traffic'
import type { TrafficEntry, TrafficWeek } from '@/types'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const weekLabel = searchParams.get('weekLabel')
  const weekStart = searchParams.get('weekStart')
  const weekEnd = searchParams.get('weekEnd')

  if (!projectId || !weekLabel) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const entries = await prisma.trafficEntry.findMany({
      where: { projectId, weekLabel },
      orderBy: { dayOfWeek: 'asc' },
    })

    const weekData: TrafficWeek = {
      weekLabel,
      weekStart: weekStart || new Date().toISOString().split('T')[0],
      weekEnd: weekEnd || new Date().toISOString().split('T')[0],
      entries: entries as unknown as TrafficEntry[],
    }

    const buffer = await generateTrafficExcel(
      entries as unknown as TrafficEntry[],
      weekData,
      project.name
    )

    const filename = `Trafico-${project.name.replace(/\s+/g, '-')}-${weekLabel}.xlsx`
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
