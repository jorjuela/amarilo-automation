import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const weekLabel = searchParams.get('weekLabel')

  try {
    const entries = await prisma.trafficEntry.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(weekLabel ? { weekLabel } : {}),
      },
      orderBy: [{ weekStart: 'asc' }, { dayOfWeek: 'asc' }],
    })
    return NextResponse.json(entries)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch traffic' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (Array.isArray(body)) {
      const created = await prisma.trafficEntry.createMany({ data: body })
      return NextResponse.json(created, { status: 201 })
    }

    const entry = await prisma.trafficEntry.create({ data: body })
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...data } = body
    const updated = await prisma.trafficEntry.update({ where: { id }, data })
    return NextResponse.json(updated)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  try {
    await prisma.trafficEntry.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 })
  }
}
