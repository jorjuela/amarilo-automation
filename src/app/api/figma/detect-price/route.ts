// POST /api/figma/detect-price
// Receives a base64 PNG of a Figma frame + known price nodes from Figma API.
// Uses Gemini Vision as a second pass to confirm/augment price detection,
// then returns the element list ready for the to-html pipeline.

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { PriceNode, FigmaTextStyle, FigmaColor } from '@/lib/figma/client'
import { figmaColorToCss } from '@/lib/figma/client'

interface DetectPriceRequest {
  imageBase64: string           // data:image/png;base64,... of the exported frame
  frameWidth: number
  frameHeight: number
  knownPriceNodes?: PriceNode[] // from Figma API structural analysis
}

interface PriceElement {
  id: string
  text: string
  top: number      // % from top of frame
  left: number     // % from left of frame
  fontSize: number
  fontWeight: number
  fontFamily: string
  color: string    // CSS rgba
  bounds: { x: number; y: number; width: number; height: number }
}

const DETECT_PROMPT = `Eres experto en diseño gráfico publicitario inmobiliario.
Analiza esta pieza publicitaria de Amarilo Colombia.
Tu tarea es identificar TODOS los textos que representan precios o valores monetarios.

Responde SOLO con JSON válido — array de objetos:
[
  {
    "id": "price_1",
    "text": "texto exacto del precio tal como aparece en la imagen",
    "topPct": 45.5,
    "leftPct": 20.3,
    "estimatedFontSizePx": 48,
    "isBold": true,
    "colorHex": "#FFFFFF",
    "confidence": "high | medium | low"
  }
]

Reglas:
- topPct y leftPct son porcentajes (0-100) de la posición relativa dentro de la imagen
- Incluye: precios en pesos ($450.000.000), SMMLV (desde 235 SMMLV), "desde $X", valores como "450M", "450 millones"
- NO incluyas: nombres de proyectos, ciudades, slogans, ni textos que no sean valores monetarios
- Si no encuentras precios, devuelve array vacío []
- Responde SOLO el JSON, sin explicaciones`

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as DetectPriceRequest
  const { imageBase64, frameWidth, frameHeight, knownPriceNodes = [] } = body

  if (!imageBase64) return NextResponse.json({ error: 'imageBase64 requerido' }, { status: 400 })

  const results: PriceElement[] = []

  // 1. Use Figma structural data (highest precision — exact positions)
  for (const node of knownPriceNodes) {
    results.push({
      id: node.id,
      text: node.text,
      top: ((node.bounds.y / frameHeight) * 100),
      left: ((node.bounds.x / frameWidth) * 100),
      fontSize: node.style.fontSize,
      fontWeight: node.style.fontWeight,
      fontFamily: node.style.fontFamily || 'Inter',
      color: figmaColorToCss(node.color),
      bounds: node.bounds,
    })
  }

  // 2. Run Gemini Vision for visual confirmation / additional detection
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

      // Strip data URL prefix for Gemini
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')

      const result = await model.generateContent([
        DETECT_PROMPT,
        { inlineData: { mimeType: 'image/png', data: base64Data } },
      ])

      const raw = result.response.text().trim()
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\[[\s\S]*\])/)
      const detected = JSON.parse(m ? m[1] : raw) as Array<{
        id: string; text: string; topPct: number; leftPct: number
        estimatedFontSizePx: number; isBold: boolean; colorHex: string; confidence: string
      }>

      const existingTexts = new Set(results.map((r) => r.text.trim().toLowerCase()))

      for (const d of detected) {
        if (d.confidence === 'low') continue
        const normalizedText = String(d.text || '').trim()
        if (!normalizedText || existingTexts.has(normalizedText.toLowerCase())) continue

        // This is a new price found by vision (not in Figma structure)
        existingTexts.add(normalizedText.toLowerCase())
        results.push({
          id: `vision_${d.id || results.length}`,
          text: normalizedText,
          top: Number(d.topPct) || 50,
          left: Number(d.leftPct) || 50,
          fontSize: Number(d.estimatedFontSizePx) || 32,
          fontWeight: d.isBold ? 700 : 400,
          fontFamily: 'Inter',
          color: d.colorHex || '#FFFFFF',
          bounds: {
            x: (Number(d.leftPct) / 100) * frameWidth,
            y: (Number(d.topPct) / 100) * frameHeight,
            width: 200,
            height: 50,
          },
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

// Helper used by the Figma editor client to build font CSS from a PriceElement
export function buildPriceFontStyle(el: {
  fontSize: number; fontWeight: number; fontFamily: string; color: string
}): string {
  return `font-family: '${el.fontFamily}', sans-serif; font-size: ${el.fontSize}px; font-weight: ${el.fontWeight}; color: ${el.color};`
}

export type { PriceElement, DetectPriceRequest, FigmaTextStyle, FigmaColor }
