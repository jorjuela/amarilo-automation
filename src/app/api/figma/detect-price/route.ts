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

const DETECT_PROMPT = `CONTEXT:
The output will be used to place replacement price overlays on top of the original creative at exact pixel coordinates. Bounding box precision is critical because small positioning errors can cause visible misalignment.

TASK:
Detect every text element in the image that represents a monetary value, price, payable amount, installment amount, financing amount, rent, fee, rate with currency, or any other market-facing financial figure.

The creative may be in any language, currency, script, country, industry, or layout.

OUTPUT FORMAT:
Return ONLY a raw JSON array.
Do NOT return markdown.
Do NOT return code fences.
Do NOT return explanations.
Do NOT return any text before or after the JSON.

Return an array of objects using this exact field structure:
[
  {
    "id": "<sequential_identifier>",
    "text": "<exact_text_as_rendered>",
    "topPct": <float_with_2_decimals>,
    "leftPct": <float_with_2_decimals>,
    "widthPct": <float_with_2_decimals>,
    "heightPct": <float_with_2_decimals>,
    "estimatedFontSizePx": <integer>,
    "isBold": <boolean>,
    "isItalic": <boolean>,
    "colorHex": "<hex_color>",
    "confidence": "<high_or_medium>"
  }
]

BOUNDING BOX RULES:
- topPct and heightPct must be measured relative to the full image height.
- leftPct and widthPct must be measured relative to the full image width.
- The bounding box must be the tightest possible rectangle enclosing the actual visible glyphs.
- Do NOT add padding.
- Do NOT measure the container, background shape, paragraph box, line-height box, or safe area.
- Measure only the actual rendered text ink boundary.
- If a single financial expression is split across multiple lines but visually belongs together, return it as one element with one bounding box.
- If separate financial expressions are visually independent, return them as separate elements.
- All percentage coordinates and dimensions must be numeric floats with exactly 2 decimal places.

TEXT RULES:
- Copy the text exactly as rendered.
- Preserve symbols, separators, spacing, casing, punctuation, abbreviations, and line breaks.
- Do NOT normalize.
- Do NOT translate.
- Do NOT infer missing characters.
- Do NOT reformat the text.

FIELD RULES:
- id: assign sequential identifiers in reading order.
- text: exact visible string of the detected financial text element.
- estimatedFontSizePx: approximate visible capital-letter height, or equivalent dominant glyph height, at the image's native resolution.
- isBold: true only if the text is visually heavier than nearby non-price body text.
- isItalic: true only if the glyphs are visibly slanted.
- colorHex: dominant glyph color only, in uppercase hexadecimal format using #RRGGBB.
- confidence: use only "high" or "medium".
- Omit any detection that would be considered low confidence.

INCLUDE:
Detect any text element that functions as a monetary or financial amount, including but not limited to:
- full prices
- shorthand price notation
- qualified prices
- price ranges
- per-unit prices
- installment or financing amounts
- rent or lease amounts
- down payments
- booking or reservation amounts
- commercial figures expressed through local financial reference units
- any numeric expression that clearly functions as a price or payable market-facing amount in context

EXCLUDE:
Do NOT return:
- brand names
- project names
- headlines or slogans that are not prices
- generic body copy
- disclaimers
- addresses
- postal codes
- phone numbers
- dates
- times
- unit numbers
- floor numbers
- reference codes
- product codes
- dimensions or area figures without financial meaning
- standalone percentages that are not payable amounts
- non-financial quantities, counts, or measurements

DISAMBIGUATION:
Only return a text element if it functions as a monetary, payable, commercial, or financial figure in context.
A number by itself is not sufficient unless its role as a financial amount is visually or semantically clear.

DEDUPLICATION:
- Do NOT duplicate the same visible text element.
- Do NOT split one grouped price into multiple objects unless the design clearly separates them.
- If the same financial value appears in different locations, return each visible instance separately.

ORDER:
Return results in reading order: top-to-bottom, then left-to-right.

EMPTY RESULT:
If no monetary or financial text is found, return an empty JSON array.`

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
