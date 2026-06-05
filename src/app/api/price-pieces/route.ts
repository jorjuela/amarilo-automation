import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')

  try {
    const pieces = await prisma.pricePiece.findMany({
      where: { active: true, ...(projectId ? { projectId } : {}) },
      include: { project: { select: { id: true, name: true, city: true, stage: true } } },
      orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json(pieces)
  } catch { return NextResponse.json({ error: 'DB error' }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const piece = await prisma.pricePiece.create({
      data: body,
      include: { project: { select: { id: true, name: true, city: true, stage: true } } },
    })
    return NextResponse.json(piece, { status: 201 })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

export async function PUT(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    // Batch: array of { id, currentPrice, priceSMMLV, priceConfig? }
    if (Array.isArray(body)) {
      const updated = await Promise.all(
        body.map(({ id, ...data }) =>
          prisma.pricePiece.update({ where: { id }, data, include: { project: { select: { id: true, name: true, city: true, stage: true } } } })
        )
      )
      return NextResponse.json(updated)
    }
    const { id, ...data } = body
    const updated = await prisma.pricePiece.update({
      where: { id }, data,
      include: { project: { select: { id: true, name: true, city: true, stage: true } } },
    })
    return NextResponse.json(updated)
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  try {
    await prisma.pricePiece.update({ where: { id }, data: { active: false } })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
