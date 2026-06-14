// POST /api/figma/html-render
// Reconstructs a Figma frame as HTML/CSS, replaces price text, renders PNG.
//
// Performance optimisations vs naive implementation:
//   1. Module-level browser instance — no cold start after the first request.
//   2. Module-level Figma file cache (20-min TTL) — no repeated API calls.
//   3. Module-level image-map cache (20-min TTL) — single getFileImages call.
//   4. Frame-scoped image proxification — only download the images used by THIS
//      frame, not every image in the file.
//   5. waitUntil:'domcontentloaded' — all images are base64, no external fetch.
//   6. No Google Fonts — avoids an extra network round-trip in Playwright.

export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  parseFigmaUrl,
  getFigmaFile,
  getFileImages,
  type FigmaNode,
  type FigmaFile,
} from '@/lib/figma/client'
import { buildFrameHtml, type HtmlRenderOptions } from '@/lib/figma/html-renderer'
import type { Browser } from 'playwright'

// ─── Module-level caches (survive the process lifetime on Railway) ────────────

const CACHE_TTL_MS = 20 * 60 * 1000 // 20 minutes

let _browser: Browser | null = null

// fileKey → { file, ts }
const _fileCache = new Map<string, { file: FigmaFile; ts: number }>()
// fileKey → { map, ts }
const _imgMapCache = new Map<string, { map: Record<string, string>; ts: number }>()

async function getSharedBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser
  const { chromium } = await import('playwright')
  _browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  return _browser
}

async function cachedGetFile(token: string, fileKey: string): Promise<FigmaFile> {
  const hit = _fileCache.get(fileKey)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.file
  const file = await getFigmaFile(token, fileKey)
  _fileCache.set(fileKey, { file, ts: Date.now() })
  return file
}

async function cachedGetImageMap(
  token: string,
  fileKey: string,
): Promise<Record<string, string>> {
  const hit = _imgMapCache.get(fileKey)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.map
  const map = await getFileImages(token, fileKey)
  _imgMapCache.set(fileKey, { map, ts: Date.now() })
  return map
}

// ─── Frame lookup ─────────────────────────────────────────────────────────────

function findFrame(file: FigmaFile, frameId: string): FigmaNode | null {
  for (const page of file.document.children) {
    const found = findNode(page.children, frameId)
    if (found) return found
  }
  return null
}

function findNode(nodes: FigmaNode[], id: string): FigmaNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

// ─── Frame-scoped image proxification ────────────────────────────────────────
// Walk the frame node tree, collect every imageRef referenced in fills,
// then download ONLY those images. A typical frame uses 1-5 images.

function collectImageRefs(node: FigmaNode, out: Set<string>): void {
  node.fills?.forEach((f) => { if (f.type === 'IMAGE' && f.imageRef) out.add(f.imageRef) })
  node.children?.forEach((c) => collectImageRefs(c, out))
}

async function proxifyFrameImages(
  rawMap: Record<string, string>,
  frameNode: FigmaNode,
): Promise<Record<string, string>> {
  const needed = new Set<string>()
  collectImageRefs(frameNode, needed)

  const entries = [...needed]
    .filter((ref) => rawMap[ref])
    .map((ref) => [ref, rawMap[ref]] as [string, string])

  if (!entries.length) return {}

  const pairs = await Promise.all(
    entries.map(async ([ref, url]): Promise<[string, string]> => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
        if (!res.ok) return [ref, url]            // keep CDN URL as fallback
        const buf = await res.arrayBuffer()
        const mime = res.headers.get('content-type') || 'image/png'
        return [ref, `data:${mime};base64,${Buffer.from(buf).toString('base64')}`]
      } catch {
        return [ref, url]                          // keep CDN URL as fallback
      }
    }),
  )

  return Object.fromEntries(pairs)
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    fileUrl: string
    frameId: string
    newPrice: string
    priceLayerName?: string
  }
  const { fileUrl, frameId, newPrice, priceLayerName = 'precio' } = body

  if (!fileUrl || !frameId || !newPrice?.trim()) {
    return NextResponse.json(
      { error: 'fileUrl, frameId y newPrice son requeridos' },
      { status: 400 },
    )
  }

  const fileKey = parseFigmaUrl(fileUrl)
  if (!fileKey) return NextResponse.json({ error: 'URL de Figma inválida' }, { status: 400 })

  // Settings read + browser warm-up in parallel
  const [settingsRecord, browser] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 'singleton' } }),
    getSharedBrowser(),
  ])

  const token: string | undefined = settingsRecord
    ? JSON.parse(settingsRecord.data).figma?.token
    : undefined
  if (!token) return NextResponse.json({ error: 'Token de Figma no configurado' }, { status: 400 })

  try {
    // ── 1. File + image-map (both cached after first call) ───────────────────
    const [file, rawImageMap] = await Promise.all([
      cachedGetFile(token, fileKey),
      cachedGetImageMap(token, fileKey),
    ])

    // ── 2. Find frame ────────────────────────────────────────────────────────
    const frameNode = findFrame(file, frameId)
    if (!frameNode) {
      return NextResponse.json(
        { error: `Frame ${frameId} no encontrado` },
        { status: 404 },
      )
    }

    // ── 3. Proxify only the images this frame actually uses ──────────────────
    const base64ImageMap = await proxifyFrameImages(rawImageMap, frameNode)

    // ── 4. Build HTML (no Google Fonts — pure offline render) ────────────────
    const opts: HtmlRenderOptions = {
      priceLayerName,
      newPrice: newPrice.trim(),
      imageMap: rawImageMap,   // kept as CDN-URL fallback inside renderer
      base64ImageMap,
    }
    const html = buildFrameHtml(frameNode, opts)

    // ── 5. Render with the shared browser (no cold start) ────────────────────
    const bounds = frameNode.absoluteBoundingBox ?? { x: 0, y: 0, width: 540, height: 960 }
    const w = Math.round(bounds.width)
    const h = Math.round(bounds.height)

    const page = await browser.newPage()
    let screenshot: Buffer
    try {
      await page.setViewportSize({ width: w, height: h })
      // domcontentloaded is sufficient: all images are embedded as data URIs.
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      // Short settle for final CSS paint (no font download needed).
      await page.waitForTimeout(80)
      screenshot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: w, height: h },
      }) as unknown as Buffer
    } finally {
      await page.close()   // close PAGE (not browser) to keep instance warm
    }

    return new NextResponse(screenshot as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="frame.png"',
        'Content-Length': String(screenshot.length),
      },
    })
  } catch (err) {
    console.error('[html-render] error:', err)
    // If the shared browser crashed, clear it so the next request re-launches.
    if (_browser && !_browser.isConnected()) _browser = null
    return NextResponse.json({ error: String(err).slice(0, 400) }, { status: 500 })
  }
}
