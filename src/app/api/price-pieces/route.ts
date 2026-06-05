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
      where: { ...(projectId ? { projectId } : {}), active: true },
      include: { project: { select: { id: true, name: true, city: true, stage: true } } },
      orderBy: [{ projectId: 'asc' }, { format: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json(pieces)
  } catch { return NextResponse.json({ error: 'DB error' }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const piece = await prisma.pricePiece.create({ data: body })
    return NextResponse.json(piece, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    // Batch update: array of { id, currentPrice, priceSMMLV, areas, tagline }
    if (Array.isArray(body)) {
      const updated = await Promise.all(
        body.map(({ id, ...data }) => prisma.pricePiece.update({ where: { id }, data }))
      )
      return NextResponse.json(updated)
    }
    const { id, ...data } = body
    const updated = await prisma.pricePiece.update({ where: { id }, data })
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  try {
    await prisma.pricePiece.update({ where: { id }, data: { active: false } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
