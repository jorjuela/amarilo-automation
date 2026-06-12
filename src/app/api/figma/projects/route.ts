// GET /api/figma/projects
// Returns existing Project records (from email processing) with their Figma campaigns.
// Projects are read-only here — they are created automatically when briefs are processed.

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projects = await prisma.project.findMany({
    where: { status: 'active' },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      macroProject: true,
      city: true,
      stage: true,
      figmaCampaigns: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  // Normalize: rename figmaCampaigns → campaigns for client consistency
  return NextResponse.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      macroProject: p.macroProject,
      city: p.city,
      stage: p.stage,
      campaigns: p.figmaCampaigns,
    })),
  })
}
