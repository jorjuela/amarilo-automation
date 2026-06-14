// POST /api/figma/detect-price
// Receives a base64 PNG of a Figma frame + structural data from the Figma API.
// Uses Gemini Vision as a second pass to confirm/augment price detection.
// Returns PriceElement list with positions relative to the frame (0-100 %).

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { PriceNode } from '@/lib/figma/client'
import { figmaColorToCss } from '@/lib/figma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FrameBounds {
  x: number
  y: number
  width: number
  height: number
}

interface DetectPriceRequest {
  imageBase64: string       // data:image/png;base64,... of the exported frame
  frameBounds: FrameBounds  // absolute bounds of the frame in Figma canvas
  knownPriceNodes?: PriceNode[]
}

export interface PriceElement {
  id: string
  text: string
  top: number       // % from top of frame (0-100)
  left: number      // % from left of frame (0-100)
  widthPct: number  // % width of frame
  heightPct: number // % height of frame
  fontSize: number  // original px size from Figma
  fontWeight: number
  fontFamily: string
  color: string     // CSS rgba (text color)
  containerColor?: string  // CSS rgba — fill behind this price area
  // Full container geometry — used to paint the erase rect at the exact right
  // size/shape/style, regardless of the price text bounds.
  containerBounds?: { top: number; left: number; widthPct: number; heightPct: number }
  containerCornerRadius?: number   // px
  containerOpacity?: number        // 0-1
  containerBlendMode?: string      // Figma blend mode, e.g. 'MULTIPLY'
  // Typography fidelity — all sourced from Figma node.style
  italic: boolean
  letterSpacing: number      // px (Figma absolute pixel value)
  lineHeightPx: number | null
  textAlignHorizontal: string // LEFT | CENTER | RIGHT | JUSTIFIED
  textCase: string           // UPPER | LOWER | TITLE | ORIGINAL | SMALL_CAPS
  textDecoration: string     // NONE | UNDERLINE | STRIKETHROUGH
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const DETECT_PROMPT = `You are a precise visual parser for advertising and marketing creatives.

Your task: locate every text element in this image that represents a monetary value, price, or numeric financial figure. The creative may be in any language, currency, or market.

Return ONLY a valid JSON array. No explanation, no markdown, no extra text.

Schema per element:
[
  {
    "id": "price_1",
    "text": "exact text string as it appears in the image — preserve formatting, symbols, separators",
    "topPct": 45.5,
    "leftPct": 20.3,
    "widthPct": 40.0,
    "estimatedFontSizePx": 48,
    "isBold": true,
    "colorHex": "#FFFFFF",
    "confidence": "high"
  }
]

Field rules:
- topPct / leftPct: top-left corner of the text bounding box, as % of image height/width (0–100)
- widthPct: width of the text bounding box as % of image width
- estimatedFontSizePx: visual font size estimate in pixels at the image's native resolution
- isBold: true if the stroke weight is visually heavier than body text
- colorHex: dominant text color in #RRGGBB
- confidence: "high" (clearly a price), "medium" (likely a price), "low" (ambiguous) — omit low-confidence results

INCLUDE — any of these patterns, in any currency or language:
- Currency symbols + number: $450,000 · €1.200 · £850k · ¥2,500,000
- Numeric shorthand: 450M · 1.2B · 850K · 2.5MM
- Wage/index multiples: 235 SMMLV · 12× minimum wage · 8 UVT
- Qualified prices: "From $X" · "Desde $X" · "Starting at £X" · "Ab €X"
- Price ranges: "$400M – $600M" · "€1.200 – €1.500"
- Per-unit prices: "$5,000/m²" · "USD 120/sqft"

EXCLUDE — never include:
- Project names, brand names, taglines, slogans
- Dates, phone numbers, percentages that are not prices (e.g. "30% off" → include the resulting price if shown, not the % itself)
- Street addresses, postal codes, area measurements without a currency
- Pure area figures: "120 m²" alone (only include if paired with a price in the same text element)

If no monetary values are present, return [].`

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as DetectPriceRequest
  const { imageBase64, frameBounds, knownPriceNodes = [] } = body

  if (!imageBase64) return NextResponse.json({ error: 'imageBase64 requerido' }, { status: 400 })
  if (!frameBounds) return NextResponse.json({ error: 'frameBounds requerido' }, { status: 400 })

  const { x: frameX, y: frameY, width: frameW, height: frameH } = frameBounds
  const results: PriceElement[] = []

  // ── 1. Structural data from Figma (exact positions) ────────────────────────
  // Figma absoluteBoundingBox coords are relative to the canvas origin.
  // Subtract the frame's origin to get frame-relative positions.
  for (const node of knownPriceNodes) {
    const relX = node.bounds.x - frameX
    const relY = node.bounds.y - frameY
    const fill = node.color

    // Container bounds: convert absolute canvas coords → % relative to frame
    let containerBounds: PriceElement['containerBounds'] | undefined
    if (node.container?.bounds) {
      const cb = node.container.bounds
      containerBounds = {
        top:      ((cb.y - frameY) / frameH) * 100,
        left:     ((cb.x - frameX) / frameW) * 100,
        widthPct:  (cb.width  / frameW) * 100,
        heightPct: (cb.height / frameH) * 100,
      }
    }

    results.push({
      id: node.id,
      text: node.text,
      top: (relY / frameH) * 100,
      left: (relX / frameW) * 100,
      widthPct: (node.bounds.width / frameW) * 100,
      heightPct: (node.bounds.height / frameH) * 100,
      fontSize: node.style.fontSize,
      fontWeight: node.style.fontWeight,
      fontFamily: node.style.fontFamily || 'Inter',
      color: figmaColorToCss(fill),
      containerColor: node.container?.color
        ? figmaColorToCss(node.container.color)
        : (node.containerColor ? figmaColorToCss(node.containerColor) : undefined),
      containerBounds,
      containerCornerRadius: node.container?.cornerRadius,
      containerOpacity: node.container?.opacity,
      containerBlendMode: node.container?.blendMode,
      // Typography fidelity
      italic: node.style.italic ?? false,
      letterSpacing: node.style.letterSpacing ?? 0,
      lineHeightPx: node.style.lineHeightPx ?? null,
      textAlignHorizontal: node.style.textAlignHorizontal ?? 'LEFT',
      textCase: node.style.textCase ?? 'ORIGINAL',
      textDecoration: node.style.textDecoration ?? 'NONE',
    })
  }

  // ── 2. Gemini Vision (visual confirmation + extra detection) ───────────────
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')

      const result = await model.generateContent([
        DETECT_PROMPT,
        { inlineData: { mimeType: 'image/png', data: base64Data } },
      ])

      const raw = result.response.text().trim()
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\[[\s\S]*\])/)
      const detected = JSON.parse(m ? m[1] : raw) as Array<{
        id: string; text: string; topPct: number; leftPct: number; widthPct?: number
        estimatedFontSizePx: number; isBold: boolean; colorHex: string; confidence: string
      }>

      const existingTexts = new Set(results.map((r) => r.text.trim().toLowerCase()))

      for (const d of detected) {
        if (d.confidence === 'low') continue
        const normalizedText = String(d.text || '').trim()
        if (!normalizedText || existingTexts.has(normalizedText.toLowerCase())) continue

        existingTexts.add(normalizedText.toLowerCase())
        results.push({
          id: `vision_${results.length}`,
          text: normalizedText,
          top: Number(d.topPct) || 50,
          left: Number(d.leftPct) || 50,
          widthPct: Number(d.widthPct) || 30,
          heightPct: (Number(d.estimatedFontSizePx) / frameH) * 100 * 1.4,
          fontSize: Number(d.estimatedFontSizePx) || 32,
          fontWeight: d.isBold ? 700 : 400,
          fontFamily: 'Inter',
          color: d.colorHex || '#FFFFFF',
          // Vision detections have no style metadata — use safe defaults
          italic: false,
          letterSpacing: 0,
          lineHeightPx: null,
          textAlignHorizontal: 'LEFT',
          textCase: 'ORIGINAL',
          textDecoration: 'NONE',
        })
      }
    } catch (geminiErr) {
      console.error('Gemini price detection error:', geminiErr)
      // Continue with structural data only
    }
  }

  return NextResponse.json({
    priceElements: results,
    count: results.length,
    sources: {
      figmaStructural: knownPriceNodes.length,
      visionDetected: results.length - knownPriceNodes.length,
    },
  })
}
