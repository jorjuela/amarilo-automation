// GET  /api/figma?fileUrl=...  → list frames in a Figma file with detected price nodes
// POST /api/figma               → export selected frames as base64 PNGs (via Figma CDN → proxy)

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  parseFigmaUrl,
  getFigmaFile,
  extractFramesFromFile,
  exportFigmaFrames,
} from '@/lib/figma/client'

async function getFigmaToken(req: NextRequest): Promise<string | null> {
  // Token from query param (convenience) or from saved settings
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  if (queryToken) return queryToken

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  if (!settings) return null
  const config = JSON.parse(settings.data)
  return config.figma?.token || null
}

// GET: fetch file frames + price nodes
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const fileUrl = url.searchParams.get('fileUrl')
  if (!fileUrl) return NextResponse.json({ error: 'fileUrl requerido' }, { status: 400 })

  const fileKey = parseFigmaUrl(fileUrl)
  if (!fileKey) return NextResponse.json({ error: 'URL de Figma inválida. Formato: https://www.figma.com/file/KEY/...' }, { status: 400 })

  const token = await getFigmaToken(req)
  if (!token) return NextResponse.json({ error: 'Token de Figma no configurado. Ve a Configuración para agregarlo.' }, { status: 400 })

  try {
    const file = await getFigmaFile(token, fileKey)
    const frames = extractFramesFromFile(file)
    return NextResponse.json({
      fileKey,
      fileName: file.name,
      lastModified: file.lastModified,
      frames,
      totalFrames: frames.length,
      framesWithPrices: frames.filter((f) => f.priceNodes.length > 0).length,
    })
  } catch (err) {
    const msg = String(err)
    if (msg.includes('403')) return NextResponse.json({ error: 'Acceso denegado. Verifica que el token tenga acceso al archivo.' }, { status: 403 })
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}

// POST: export selected frames as base64 images
export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { fileKey: string; frameIds: string[]; scale?: number }
  const { fileKey, frameIds, scale = 2 } = body

  if (!fileKey || !frameIds?.length) {
    return NextResponse.json({ error: 'fileKey y frameIds requeridos' }, { status: 400 })
  }

  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  let token: string | null = queryToken
  if (!token) {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    token = settings ? JSON.parse(settings.data).figma?.token || null : null
  }

  if (!token) return NextResponse.json({ error: 'Token de Figma no configurado' }, { status: 400 })

  try {
    // Get CDN URLs from Figma API
    const imageUrls = await exportFigmaFrames(token, fileKey, frameIds, scale)

    // Proxy each image to base64 (CDN URLs expire; we serve them to the client immediately)
    const results: Record<string, string> = {}
    await Promise.all(
      Object.entries(imageUrls).map(async ([nodeId, cdnUrl]) => {
        if (!cdnUrl) { results[nodeId] = ''; return }
        const imgRes = await fetch(cdnUrl)
        const buf = await imgRes.arrayBuffer()
        results[nodeId] = `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
      })
    )

    return NextResponse.json({ images: results })
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 })
  }
}
