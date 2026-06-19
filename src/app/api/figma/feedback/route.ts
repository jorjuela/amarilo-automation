// POST /api/figma/feedback  — save a feedback record
// GET  /api/figma/feedback  — list all records (newest first)

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    figmaUrl: string
    frameName: string
    frameId: string
    originalPrice: string
    newPrice: string
    label: 'correct' | 'error'
    errorCategory?: string
    description?: string
    generatedPng?: string
    frameWidth?: number
    frameHeight?: number
  }

  const { figmaUrl, frameName, frameId, originalPrice, newPrice, label } = body
  if (!figmaUrl || !frameName || !frameId || !originalPrice || !newPrice || !label) {
    return NextResponse.json({ error: 'Campos requeridos incompletos' }, { status: 400 })
  }

  const record = await prisma.priceFeedback.create({
    data: {
      figmaUrl,
      frameName,
      frameId,
      originalPrice,
      newPrice,
      label,
      errorCategory: body.errorCategory ?? null,
      description: body.description ?? null,
      generatedPng: body.generatedPng ?? null,
      frameWidth: body.frameWidth ?? null,
      frameHeight: body.frameHeight ?? null,
    },
  })

  return NextResponse.json({ id: record.id })
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? '100'), 500)

  const records = await prisma.priceFeedback.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    // Omit the heavy generatedPng column from list view
    select: {
      id: true,
      createdAt: true,
      figmaUrl: true,
      frameName: true,
      frameId: true,
      originalPrice: true,
      newPrice: true,
      label: true,
      errorCategory: true,
      description: true,
      frameWidth: true,
      frameHeight: true,
    },
  })

  const counts = await prisma.priceFeedback.groupBy({
    by: ['label'],
    _count: { label: true },
  })

  const stats = {
    total: counts.reduce((acc, c) => acc + c._count.label, 0),
    correct: counts.find((c) => c.label === 'correct')?._count.label ?? 0,
    error: counts.find((c) => c.label === 'error')?._count.label ?? 0,
  }

  return NextResponse.json({ records, stats })
}
