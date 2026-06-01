import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createAmiloClientSheet } from '@/lib/sheets/google-sheets'

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json()

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { torres: true },
    })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    if (!settings) return NextResponse.json({ error: 'Settings not configured' }, { status: 400 })

    const config = JSON.parse(settings.data)
    if (!config.googleDrive?.clientEmail || !config.googleDrive?.privateKey) {
      return NextResponse.json({ error: 'Google Drive not configured' }, { status: 400 })
    }

    const projectWithTorres = {
      ...project,
      torres: project.torres.map((t) => ({ ...t, areas: JSON.parse(t.areas) })),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      briefParsedAt: project.briefParsedAt?.toISOString(),
      emailReceivedAt: project.emailReceivedAt?.toISOString(),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sheet = await createAmiloClientSheet(
      config.googleDrive,
      config.googleDrive.folderId || '',
      projectWithTorres as any
    )

    await prisma.project.update({
      where: { id: projectId },
      data: { googleSheetId: sheet.spreadsheetId, googleSheetUrl: sheet.url },
    })

    return NextResponse.json(sheet)
  } catch (error) {
    console.error('POST /api/sheets error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
