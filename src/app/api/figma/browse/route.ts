// GET /api/figma/browse?fileUrl=... (or ?fileKey=...)
// Uses the Figma MCP server (figma-developer-mcp) to return the simplified
// design tree — AI-readable, with text content and relative layout.
// Useful for exploring design structure without needing absolute coordinates.
//
// For price-detection coordinates use GET /api/figma (hybrid: MCP + REST).

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseFigmaUrl } from '@/lib/figma/client'
import {
  figmaMCPGetData,
  extractFrameSummaries,
  type SimplifiedDesign,
  type MCPFrameSummary,
} from '@/lib/figma/mcp-client'

async function getFigmaToken(req: NextRequest): Promise<string | null> {
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  if (queryToken) return queryToken

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  if (!settings) return null
  return JSON.parse(settings.data).figma?.token || null
}

export interface BrowseResponse {
  fileKey: string
  fileName: string
  frames: MCPFrameSummary[]
  totalFrames: number
  framesWithPrices: number
  mcpDesign?: SimplifiedDesign  // full tree, only included when ?full=true
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const fileUrl = url.searchParams.get('fileUrl')
  const fileKeyParam = url.searchParams.get('fileKey')
  const nodeId = url.searchParams.get('nodeId') || undefined
  const depth = Number(url.searchParams.get('depth') || '6')
  const includeFull = url.searchParams.get('full') === 'true'

  let fileKey: string | null = fileKeyParam
  if (!fileKey && fileUrl) {
    fileKey = parseFigmaUrl(fileUrl)
    if (!fileKey) {
      return NextResponse.json(
        { error: 'URL de Figma inválida. Formato: https://www.figma.com/file/KEY/...' },
        { status: 400 }
      )
    }
  }
  if (!fileKey) {
    return NextResponse.json({ error: 'fileUrl o fileKey requerido' }, { status: 400 })
  }

  const token = await getFigmaToken(req)
  if (!token) {
    return NextResponse.json(
      { error: 'Token de Figma no configurado. Ve a Configuración para agregarlo.' },
      { status: 400 }
    )
  }

  try {
    const design = await figmaMCPGetData(token, fileKey, nodeId, depth)
    const frames = extractFrameSummaries(design)

    const response: BrowseResponse = {
      fileKey,
      fileName: design.name,
      frames,
      totalFrames: frames.length,
      framesWithPrices: frames.filter((f) => f.hasPriceHints).length,
    }

    if (includeFull) response.mcpDesign = design

    return NextResponse.json(response)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('403') || msg.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'Acceso denegado. Verifica que el token tenga acceso al archivo.' },
        { status: 403 }
      )
    }
    if (msg.includes('timeout')) {
      return NextResponse.json(
        { error: 'Timeout conectando al servidor MCP de Figma. Intenta de nuevo.' },
        { status: 504 }
      )
    }
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 })
  }
}
