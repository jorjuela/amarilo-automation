// POST /api/figma/campaigns        → create a new campaign for a project

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, projectId, figmaUrl } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })
  if (!projectId) return NextResponse.json({ error: 'projectId requerido' }, { status: 400 })

  const campaign = await prisma.figmaCampaign.create({
    data: { name: name.trim(), projectId, figmaUrl: figmaUrl?.trim() || '' },
    include: { project: true },
  })

  return NextResponse.json({ campaign }, { status: 201 })
}
