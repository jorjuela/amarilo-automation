// GET  /api/figma?fileUrl=...  → list Figma frames with detected price nodes
//   Hybrid: MCP (simplified design + price text hints) + REST (absolute bounds, styles)
//   Falls back to REST-only if MCP is unavailable.
//
// POST /api/figma             → export selected frames as base64 PNGs (Figma REST CDN proxy)
//   Image export uses the Figma REST API directly because the MCP tool
//   (download_figma_images) writes to the local filesystem, which doesn't work
//   in a web server context.

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  parseFigmaUrl,
  getFigmaFile,
  extractFramesFromFile,
  exportFigmaFrames,
  type DetectedFrame,
} from '@/lib/figma/client'
import {
  figmaMCPGetData,
  extractFrameSummaries,
  type MCPFrameSummary,
} from '@/lib/figma/mcp-client'

// ─── Token helper ─────────────────────────────────────────────────────────────

async function getFigmaToken(req: NextRequest): Promise<string | null> {
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  if (queryToken) return queryToken

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  if (!settings) return null
  return JSON.parse(settings.data).figma?.token || null
}

// ─── GET — list frames ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const fileUrl = url.searchParams.get('fileUrl')
  if (!fileUrl) return NextResponse.json({ error: 'fileUrl requerido' }, { status: 400 })

  const fileKey = parseFigmaUrl(fileUrl)
  if (!fileKey) {
    return NextResponse.json(
      { error: 'URL de Figma inválida. Formato: https://www.figma.com/file/KEY/...' },
      { status: 400 }
    )
  }

  const token = await getFigmaToken(req)
  if (!token) {
    return NextResponse.json(
      { error: 'Token de Figma no configurado. Ve a Configuración para agregarlo.' },
      { status: 400 }
    )
  }

  try {
    // ── 1. Figma REST API: raw file data (absolute bounds + price node styles) ──
    const file = await getFigmaFile(token, fileKey)
    const frames: DetectedFrame[] = extractFramesFromFile(file)

    // ── 2. Figma MCP: simplified design (price text hints) ──────────────────────
    // Run in parallel; MCP failure is non-fatal — we still return REST data.
    let mcpSummaries: MCPFrameSummary[] = []
    try {
      const design = await figmaMCPGetData(token, fileKey, undefined, 5)
      mcpSummaries = extractFrameSummaries(design)
    } catch (mcpErr) {
      // MCP is supplementary — log but don't fail the request
      console.warn('[figma/route] MCP unavailable, using REST only:', String(mcpErr).slice(0, 200))
    }

    // ── 3. Merge: enrich REST frames with MCP price hints ───────────────────────
    const mcpByName = new Map(mcpSummaries.map((s) => [s.name, s]))
    const enrichedFrames = frames.map((f) => {
      const mcp = mcpByName.get(f.name)
      return {
        ...f,
        mcpPriceHints: mcp?.priceHintTexts ?? [],
        mcpHasPriceHints: mcp?.hasPriceHints ?? false,
      }
    })

    return NextResponse.json({
      fileKey,
      fileName: file.name,
      lastModified: file.lastModified,
      frames: enrichedFrames,
      totalFrames: enrichedFrames.length,
      framesWithPrices: enrichedFrames.filter(
        (f) => f.priceNodes.length > 0 || f.mcpHasPriceHints
      ).length,
      mcpAvailable: mcpSummaries.length > 0,
    })
  } catch (err) {
    const msg = String(err)
    if (msg.includes('403')) {
      return NextResponse.json(
        { error: 'Acceso denegado. Verifica que el token tenga acceso al archivo.' },
        { status: 403 }
      )
    }
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}

// ─── POST — export frames as base64 PNGs ─────────────────────────────────────
// Uses the Figma REST API directly (not MCP) because download_figma_images
// writes to the local filesystem, which doesn't work in a web server context.

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { fileKey: string; frameIds: string[]; scale?: number }
  const { fileKey, frameIds, scale = 2 } = body

  if (!fileKey || !frameIds?.length) {
    return NextResponse.json({ error: 'fileKey y frameIds requeridos' }, { status: 400 })
  }

  // Token from query or DB
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  let token: string | null = queryToken
  if (!token) {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    token = settings ? JSON.parse(settings.data).figma?.token || null : null
  }

  if (!token) return NextResponse.json({ error: 'Token de Figma no configurado' }, { status: 400 })

  try {
    // Figma REST: get CDN image URLs
    const imageUrls = await exportFigmaFrames(token, fileKey, frameIds, scale)

    // Proxy CDN → base64 (CDN URLs expire; serve immediately to client)
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
