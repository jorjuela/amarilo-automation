// GET  /api/figma/projects        → list all projects with their campaigns
// POST /api/figma/projects        → create a new project

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projects = await prisma.figmaProject.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      campaigns: { orderBy: { createdAt: 'desc' } },
    },
  })

  return NextResponse.json({ projects })
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })

  const project = await prisma.figmaProject.create({ data: { name: name.trim() } })
  return NextResponse.json({ project }, { status: 201 })
}
