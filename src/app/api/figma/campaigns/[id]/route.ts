// PUT    /api/figma/campaigns/:id  → update campaign (name, figmaUrl)
// DELETE /api/figma/campaigns/:id  → delete campaign

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const data: { name?: string; figmaUrl?: string } = {}
  if (body.name !== undefined) data.name = body.name.trim()
  if (body.figmaUrl !== undefined) data.figmaUrl = body.figmaUrl.trim()

  const campaign = await prisma.figmaCampaign.update({
    where: { id },
    data,
    include: { project: true },
  })

  return NextResponse.json({ campaign })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await prisma.figmaCampaign.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
