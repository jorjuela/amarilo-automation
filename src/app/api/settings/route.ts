import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    if (!settings) return NextResponse.json({})
    const data = JSON.parse(settings.data)
    // Mask sensitive fields
    if (data.gmail?.refreshToken) data.gmail.refreshToken = '***masked***'
    if (data.googleDrive?.privateKey) data.googleDrive.privateKey = '***masked***'
    if (data.figma?.token) data.figma.token = '***masked***'
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()

    // Get existing settings to not overwrite masked fields
    const existing = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    const existingData = existing ? JSON.parse(existing.data) : {}

    // Merge: if value is '***masked***', keep original
    const mergedData = deepMerge(existingData, body)

    const settings = await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', data: JSON.stringify(mergedData) },
      update: { data: JSON.stringify(mergedData) },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const val = source[key]
    if (val === '***masked***') continue
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(
        (target[key] as Record<string, unknown>) || {},
        val as Record<string, unknown>
      )
    } else {
      result[key] = val
    }
  }
  return result
}
