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
  // Background classification — retained as optional for future use or Figma-tree inference.
  // The canvas erase strategy no longer depends on these fields (pixel sampling is always used).
  backgroundType?: 'solid' | 'image' | 'gradient' | 'transparent'
  backgroundColorHex?: string | null
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
The output will be used to place replacement price overlays on top of the original creative at exact pixel coordinates. Bounding box precision is critical because even very small errors can cause visible misalignment.

PRIMARY OBJECTIVE:
Detect only text elements that contain an explicit monetary price with an explicit currency marker directly present in the same visible text element.

STRICT OPERATING MODE:
Be maximally conservative.
Prefer omission over false positives.
If there is any ambiguity, do not return the element.

IMAGE SCOPE:
The image may be in any language, script, country, industry, or layout.
It may contain decorative text, promotional copy, labels, disclaimers, tables, icons, badges, watermarks, blur, low contrast, compression artifacts, perspective distortion, or partial occlusion.

OUTPUT FORMAT:
Return ONLY a raw JSON array.
Do NOT return markdown.
Do NOT return code fences.
Do NOT return explanations.
Do NOT return comments.
Do NOT return any text before or after the JSON.

OUTPUT SCHEMA:
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
    "colorHex": "<uppercase_hex_color>",
    "confidence": "<high_or_medium>"
  }
]

ULTRA-STRICT DETECTION RULE:
Return a text element only if all of the following are true:
- it contains at least one numeric amount
- it contains an explicit currency marker directly in the same visible text element
- the numeric amount and the currency marker visually belong to the same rendered price expression
- the text clearly functions as a price or payable monetary amount

EXPLICIT CURRENCY MARKER RULE:
A valid detection must include, in the same text element as the amount, at least one of the following:
- a currency symbol
- a currency code
- a fully written currency name
- an unambiguous localized currency unit

The currency marker must be visibly rendered and directly associated with the amount.
Do not infer currency from surrounding copy, nearby labels, brand context, country context, or creative theme.

NO CONTEXTUAL INFERENCE RULE:
Do not return a number if its monetary meaning depends on nearby text, layout, or interpretation.
The price must be explicit inside the same text element itself.
If the amount is only understandable as a price because of context, exclude it.

NO AMBIGUOUS VALUE RULE:
Exclude any value that does not contain an explicit currency marker in the same text element, even if it looks like a price.
Exclude shorthand numbers, large figures, financing figures, ranges, or highlighted amounts if currency is not explicitly shown in the same detected text element.

STRICT EXCLUSION POLICY:
Never return any text element that is missing an explicit currency marker in the same visible text element.

Never return:
- standalone numbers
- shorthand magnitudes without explicit currency
- contextual prices inferred from labels
- financial reference units without explicit currency
- percentages
- discount rates
- interest rates
- installment counts by themselves
- dates
- times
- phone numbers
- addresses
- postal codes
- product codes
- reference codes
- model names
- floor numbers
- unit numbers
- dimensions
- area figures
- quantities
- counts
- slogans
- headlines that are not explicit prices
- brand names
- project names
- disclaimers
- generic body copy

PAYMENT / FINANCING RULE:
Return installment or financing text only if the same visible text element includes both:
- a numeric monetary amount
- an explicit currency marker

If the text shows only the number of installments, term length, or financing structure without explicit currency in the same text element, exclude it.

RANGE RULE:
Return a price range only if the returned text element explicitly includes currency marking as rendered.
If part of the range lacks explicit currency and the monetary meaning must be inferred, exclude it unless the entire rendered text element still explicitly and unambiguously presents the full expression as a currency price.

PARTIAL / CROPPED TEXT RULE:
If a candidate price is cropped, blurred, occluded, too small, or partially unreadable, exclude it unless the visible text still unambiguously contains both:
- the amount
- the explicit currency marker

Do not guess hidden characters.
Do not reconstruct missing symbols.
Do not complete truncated prices.

OCR FIDELITY RULE:
Copy text exactly as rendered.
Preserve: symbols, currency markers, separators, spacing, punctuation, casing, line breaks, abbreviations, slashes, dashes.
Do NOT: translate, normalize, spell-correct, expand abbreviations, infer missing characters, infer missing currency, merge separate elements unless they clearly form one single rendered price expression.

GROUPING RULE:
Treat multiple lines as one element only when they visually form one single explicit price expression and the currency marker is part of that same grouped text.
If separate text blocks do not clearly belong to one single rendered price, do not merge them.

BOUNDING BOX POLICY:
Bounding boxes must be extremely tight and must enclose only the actual visible glyphs of the returned text element.

BOUNDING BOX RULES:
- topPct and heightPct are relative to the full image height
- leftPct and widthPct are relative to the full image width
- use the tightest possible rectangle enclosing the actual rendered glyphs
- do not include padding, containers, badges, pills, backgrounds, safe areas, text alignment regions, line-height regions, shadows, glows, or decorative shapes
- do not include invisible whitespace
- for multiline text returned as one element, the box must tightly enclose all included glyphs across all included lines
- all coordinate and size values must be numeric floats with exactly 2 decimal places

BOUNDING BOX SEPARATION RULE:
A bounding box must correspond to exactly one returned text element.
Do not combine nearby but separate text elements into one box unless they are clearly one single rendered price expression.

FONT / STYLE RULES:
- estimatedFontSizePx: approximate visible capital-letter height, or equivalent dominant glyph height, at native image resolution
- isBold: true only if the stroke weight is visibly heavier than nearby non-price body text
- isItalic: true only if glyphs are visibly slanted
- colorHex: dominant glyph color only, excluding outline, shadow, glow, gradient edge, or background; return as uppercase #RRGGBB

CONFIDENCE RULES:
- "high": text explicitly contains both the amount and the currency marker and is unambiguously a price
- "medium": text explicitly contains both the amount and the currency marker and is very likely a price, but the rendering is slightly degraded
- Do not output low-confidence detections. If confidence would be low, exclude the element.

DEDUPLICATION RULE:
- do not duplicate the same visible text element
- do not return overlapping duplicates
- if the same explicit price appears in different locations, return each visible instance separately

ORDERING RULE:
Return results in reading order: top-to-bottom, then left-to-right.

ID RULE:
Assign sequential identifiers in output order.

EMPTY RESULT RULE:
If no text element satisfies all ultra-strict criteria, return an empty JSON array.`

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
