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
  // Background classification (from vision model) — drives erase strategy selection.
  // solid       → paint containerColor / backgroundColorHex over text area
  // image       → crop pixels from background image (never paint solid color)
  // gradient    → sample adjacent pixels; never paint solid color
  // transparent → no distinct background; overlay text directly
  backgroundType?: 'solid' | 'image' | 'gradient' | 'transparent'
  backgroundColorHex?: string | null  // #RRGGBB when backgroundType === 'solid'; else null
  // Typography fidelity — all sourced from Figma node.style
  italic: boolean
  letterSpacing: number      // px (Figma absolute pixel value)
  lineHeightPx: number | null
  textAlignHorizontal: string // LEFT | CENTER | RIGHT | JUSTIFIED
  textCase: string           // UPPER | LOWER | TITLE | ORIGINAL | SMALL_CAPS
  textDecoration: string     // NONE | UNDERLINE | STRIKETHROUGH
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const DETECT_PROMPT = `CONTEXT — HOW THIS OUTPUT IS USED:
Each bounding box drives TWO rendering steps:
  STEP 1 — ERASE: the old price text is masked (painted over) at the exact bounding box position.
  STEP 2 — RENDER: the new price text is placed at that exact position with the same typography.

Errors in bounding box precision or backgroundType cause visible defects:
  • Box too large  → erases adjacent design elements (logos, decorations).
  • Box too small  → old text pixels peek out around the new text.
  • backgroundType wrong → wrong fill strategy (e.g. solid black rect over a photo background).

YOU ARE: a precision layout-analysis model for marketing creatives.

TASK:
Find every KEY CHANGEABLE VALUE in the image — any prominent number, price, amount, or figure that a marketing team would update between creative versions.
Works for ANY industry (real estate, fintech, crypto, SaaS, insurance, retail, travel, …) and ANY language or currency.

OUTPUT — RAW JSON ARRAY ONLY. No markdown, no code fences, no comments, no text before or after:

[
  {
    "id": "p1",
    "text": "<exact rendered string>",
    "topPct": <float 2 dec>,
    "leftPct": <float 2 dec>,
    "widthPct": <float 2 dec>,
    "heightPct": <float 2 dec>,
    "estimatedFontSizePx": <integer>,
    "isBold": <boolean>,
    "isItalic": <boolean>,
    "colorHex": "<#RRGGBB>",
    "backgroundType": "<solid | image | gradient | transparent>",
    "backgroundColorHex": "<#RRGGBB | null>",
    "confidence": "<high | medium>"
  }
]

═══════════════════════════════════════════
BOUNDING BOX — PRECISION RULES (critical)
═══════════════════════════════════════════
The bounding box must enclose ONLY the visible ink pixels of the glyphs.

  topPct    = (px from image top to topmost ascender pixel)  ÷ image height × 100
  leftPct   = (px from image left to leftmost glyph pixel)   ÷ image width  × 100
  widthPct  = (rightmost − leftmost glyph pixel)             ÷ image width  × 100
  heightPct = (bottommost descender − topmost ascender)      ÷ image height × 100

NEVER include in the bounding box:
  • Container rectangle, card border, or background shape
  • Padding between glyph and container edge
  • Line-height gap above ascenders or below descenders
  • Drop shadows, glows, or stroke outlines that extend beyond the glyph
  • Safe-area margins, gutters, or any whitespace not part of the text

Multi-line amount that is ONE logical value → ONE bounding box enclosing all lines.
Two amounts at different positions → TWO separate objects.
All numeric fields: exactly 2 decimal places.

═══════════════════════════════════════
FIELD DEFINITIONS
═══════════════════════════════════════
id
  Sequential reading-order label: "p1", "p2", …

text
  Exact visible string, character-for-character.
  Preserve: currency symbols, separators (. , ' space), casing, line breaks (\\n), abbreviations.
  Do NOT reformat, normalise, translate, or infer missing characters.

estimatedFontSizePx
  Visible cap-height in px at native image resolution.
  For multi-size text elements: use the dominant (largest) size.

isBold
  true when the stroke weight is visually heavier than nearby body text.

isItalic
  true when glyphs are visibly slanted.

colorHex
  The GLYPH color — NOT the background color. Uppercase #RRGGBB.

backgroundType  ← CRITICAL for correct rendering
  Describes the visual surface DIRECTLY behind the text characters.
  Choose the best match from these four options:

    "solid"        A flat, single uniform-color rectangle or frame fill with no texture.
                   Example: white card, navy blue box, solid black banner.

    "image"        A photograph, illustration, or raster image tile.
                   Example: product photo, lifestyle photography, textured background.

    "gradient"     A smooth color transition (linear, radial, angular, or mesh gradient).
                   Example: blue-to-purple gradient, sunset fade.

    "transparent"  No distinct background layer — text floats over a complex layered scene
                   with no single dominant fill directly behind the glyphs.

  When in doubt between "image" and "transparent", choose "image".
  This field determines whether the renderer uses solid fill or pixel-sampling to erase the old text.

backgroundColorHex
  ONLY when backgroundType is "solid": the exact hex color of the background surface (#RRGGBB).
  For "image", "gradient", or "transparent": return null.

confidence
  "high" = unambiguously a featured value.
  "medium" = plausible but uncertain.
  Omit anything you would rate low-confidence.

═══════════════════════════════════════
WHAT TO DETECT ✓
═══════════════════════════════════════
Include when present:
  • Prices and monetary amounts — any symbol or ISO code
    ($, €, £, ¥, ₹, ₿, USD, EUR, GBP, COP, MXN, BRL, BTC, ETH, USDT, BNB, SOL, …)
  • Plan costs, subscription fees, monthly/annual pricing, installments
  • Crypto amounts, exchange rates, featured wallet balances
  • Down payments, lease amounts, financing rates, booking fees, entry fees
  • "From / Desde / À partir de / Ab / Da" + amount combinations
  • Financial percentage rates (APR, APY, ROI, "50 % OFF", "12 % anual", yield %)
  • Large formatted numbers that are the creative's hero commercial figure
    ("600,555,0000" · "1.200.000" · "2,500 USDT" · "$4.99/mo" · "€ 1.299")
  • Phone-like numbers ONLY when they are the LARGEST, most visually dominant element (hero position)

═══════════════════════════════════════
WHAT TO EXCLUDE ✗
═══════════════════════════════════════
Never return:
  • Brand names, logos, taglines, marketing slogans
  • Descriptive headlines without a numeric value
  • Dates, times, durations ("June 2025", "9:00 AM", "30 days")
  • Physical dimensions, floor counts, bedroom/room/unit numbers
  • Product codes, reference numbers, postal codes, addresses
  • Disclaimer or fine-print text (small font, legal/compliance section)
  • Contact phone numbers in a footer/header "call us" context (not hero-sized)
  • Counts with no commercial meaning ("3 bedrooms", "5 km", "10 cities")
  • Decorative percentages with no financial function

═══════════════════════════════════════
DISAMBIGUATION
═══════════════════════════════════════
When a number's role is ambiguous (price vs. phone vs. code vs. reference):
  Include if: it is the largest or most visually dominant numeric element,
              OR surrounding copy implies a commercial amount
              ("price", "plan", "from", "BTC", "monthly", "fee", "only", "just").
  Exclude if: it is small, peripheral, or surrounded by contact/legal copy.

═══════════════════════════════════════
DEDUPLICATION · ORDER · EMPTY RESULT
═══════════════════════════════════════
Same text, two positions → two separate objects (one per position).
Same text, same position → one object only.
Order: top-to-bottom, then left-to-right within a row.
Empty: return [] if nothing qualifies.`

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
        backgroundType?: string; backgroundColorHex?: string | null
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

        const bgType = (['solid', 'image', 'gradient', 'transparent'] as const)
          .find((t) => t === d.backgroundType) ?? undefined

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
          backgroundType: bgType,
          backgroundColorHex: bgType === 'solid' ? (d.backgroundColorHex ?? null) : null,
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
