import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/auth'
import { generateTrafficExcel } from '@/lib/excel/traffic'
import type { TrafficEntry, TrafficWeek } from '@/types'

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const weekLabel = searchParams.get('weekLabel')
  const weekStart = searchParams.get('weekStart')
  const weekEnd   = searchParams.get('weekEnd')

  if (!weekLabel || !weekStart || !weekEnd) {
    return NextResponse.json({ error: 'weekLabel, weekStart and weekEnd are required' }, { status: 400 })
  }

  try {
    const where = {
      weekLabel,
      ...(projectId ? { projectId } : {}),
    }

    const rawEntries = await prisma.trafficEntry.findMany({
      where,
      include: { project: { select: { name: true, city: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { createdAt: 'asc' }],
    })

    // Load active collaborators for team lists
    const collabs = await prisma.collaborator.findMany({ where: { active: true } })
    const copyTeam    = collabs.filter((c) => c.role === 'COPY').map((c) => c.name)
    const graphicTeam = collabs.filter((c) => c.role === 'GRAFICO').map((c) => c.name)

    type RawEntry = typeof rawEntries[0] & { project?: { name: string; city: string } }

    const entries: (TrafficEntry & { city?: string })[] = rawEntries.map((e) => ({
      id:          e.id,
      weekStart:   e.weekStart.toISOString(),
      weekEnd:     e.weekEnd.toISOString(),
      weekLabel:   e.weekLabel,
      dayOfWeek:   e.dayOfWeek,
      campaign:    e.campaign,
      pm:          e.pm,
      requirement: e.requirement,
      numTexts:    e.numTexts,
      copyName:    e.copyName ?? undefined,
      numGraphics: e.numGraphics,
      graphicName: e.graphicName ?? undefined,
      status:      e.status,
      jiraTicket:  e.jiraTicket ?? undefined,
      notes:       e.notes ?? undefined,
      projectId:   e.projectId,
      city:        (e as RawEntry).project?.city ?? '',
    }))

    const projectName = rawEntries[0]
      ? ((rawEntries[0] as RawEntry).project?.name ?? 'Tráfico')
      : 'Tráfico'

    const weekData: TrafficWeek = { weekLabel, weekStart, weekEnd, entries: [] }

    const buffer = await generateTrafficExcel(
      entries,
      weekData,
      projectName,
      copyTeam.length    > 0 ? copyTeam    : ['Jaime', 'Laura G', 'Nata', 'Nico P'],
      graphicTeam.length > 0 ? graphicTeam : ['Nico', 'Carlos', 'Andres S', 'Brausin'],
    )

    const safeName = projectName.replace(/\s+/g, '-').replace(/[^\w-]/g, '')
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Trafico-${safeName}-${weekLabel.replace(' ', '-')}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
