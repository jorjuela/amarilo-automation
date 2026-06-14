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

const DETECT_PROMPT = `You are a sub-pixel-accurate bounding box detector for price text in advertising creatives.

CONTEXT: Your output will be used to position a replacement price overlay on top of the original image at exact pixel coordinates. Bounding box accuracy is critical — a 2% error in position causes visible misalignment.
TASK: Find every text element that represents a monetary value, price, or numeric financial figure. The creative may be in any language, currency, industry, or market.
OUTPUT FORMAT — return ONLY a raw JSON array, no markdown fences, no explanation:
[
  {
    "id": "price_1",
    "text": "exact string as rendered — preserve symbols, separators, line breaks (\\n)",
    "topPct": 45.20,
    "leftPct": 20.35,
    "widthPct": 38.50,
    "heightPct": 6.80,
    "estimatedFontSizePx": 48,
    "isBold": true,
    "isItalic": false,
    "colorHex": "#FFFFFF",
    "confidence": "high"
  }
]

BOUNDING BOX RULES (read carefully):
- topPct / leftPct: top-left corner of the tightest rectangle that encloses all glyphs, as % of image height / width
- widthPct / heightPct: width and height of that rectangle as % of image width / height
- Do NOT pad the box — measure the actual ink boundary, not the line-height or container
- For multi-line price text (e.g. "Desde\\n$450M"), the bounding box must cover all lines as a single element
- Values must be floats with 2 decimal places

FIELD RULES:
- text: copy the string verbatim including currency symbols, thousands separators, and line breaks
- estimatedFontSizePx: height of a capital letter in pixels at the image's native resolution
- isBold: true if stroke weight is visually heavier than surrounding body text
- isItalic: true if glyphs are slanted
- colorHex: sample the dominant glyph color (not background), return as #RRGGBB
- confidence: "high" = unambiguously a price; "medium" = likely a price; omit "low" results entirely

INCLUDE — detect all of these, in any language or currency:
- Currency symbol + digits: $450,000 · €1.200 · £850k · ¥2,500,000 · R$1.2M · AED 3.5M
- Numeric shorthand: 450M · 1.2B · 850K · 2.5MM · 4.5Cr
- Index multiples: 235 SMMLV · 12× minimum wage · 8 UVT · 15 NMW
- Qualified prices: "From $X" · "Desde $X" · "Starting at £X" · "Ab €X" · "À partir de €X"
- Price ranges within one text block: "$400M – $600M" · "€1.200 – €1.500"
- Per-unit prices: "$5,000/m²" · "USD 120/sqft" · "€3,500/month"
- Installment / financing labels: "12× $42,000" · "Cuotas desde $1.2M"

EXCLUDE — never return:
- Project names, brand names, slogans, legal disclaimers, body copy
- Standalone percentages that are rates, not prices ("30% off", "6.5% APR")
- Dates, phone numbers, reference codes, floor/unit numbers
- Street addresses, postal codes
- Pure area / dimension figures without a currency ("120 m²", "1,200 sqft")

If no monetary values are found, return [].`

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
        id: string; text: string; topPct: number; leftPct: number
        widthPct?: number; heightPct?: number
        estimatedFontSizePx: number; isBold: boolean; isItalic?: boolean
        colorHex: string; confidence: string
      }>

      const existingTexts = new Set(results.map((r) => r.text.trim().toLowerCase()))

      for (const d of detected) {
        if (d.confidence === 'low') continue
        const normalizedText = String(d.text || '').trim()
        if (!normalizedText || existingTexts.has(normalizedText.toLowerCase())) continue

        existingTexts.add(normalizedText.toLowerCase())
        const fsPx = Number(d.estimatedFontSizePx) || 32
        // heightPct from Gemini when available; fallback to font-size-based estimate
        const hPct = d.heightPct
          ? Number(d.heightPct)
          : (fsPx / frameH) * 100 * 1.4

        results.push({
          id: `vision_${results.length}`,
          text: normalizedText,
          top: Number(d.topPct) || 50,
          left: Number(d.leftPct) || 50,
          widthPct: Number(d.widthPct) || 30,
          heightPct: hPct,
          fontSize: fsPx,
          fontWeight: d.isBold ? 700 : 400,
          fontFamily: 'Inter',
          color: d.colorHex || '#FFFFFF',
          italic: d.isItalic ?? false,
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
