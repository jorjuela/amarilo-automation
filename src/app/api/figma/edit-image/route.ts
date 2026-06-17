// POST /api/figma/edit-image
// Sends the frame PNG + a filled edit-instruction prompt to Gemini 2.0 Flash
// and returns the AI-edited image as base64.

import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const maxDuration = 120

// ─── Prompt template ─────────────────────────────────────────────────────────

const EDIT_PROMPT_TEMPLATE = `Edit the provided creative by replacing the current price with the new requested value.

INPUT VARIABLES:
- NEW_PRICE: {{NEW_PRICE}}
- CURRENCY: {{CURRENCY}}
- LANGUAGE: {{LANGUAGE}}
- STYLE: {{STYLE}}

CORE OBJECTIVE:
Replace only the existing price content with the new value defined by {{NEW_PRICE}} and {{CURRENCY}}.
The final result must contain only the new price text, naturally integrated into the original design.

ABSOLUTE RULE:
Do not create, keep, or simulate any background behind the price.
The final price must not appear inside or on top of any box, rectangle, patch, label, banner, strip, pill, badge, chip, highlight, sticker, panel, container, or solid color shape.

BACKGROUND RESTORATION RULE:
If the current price area contains any background element, overlay, block, mask, patch, repaint area, or artificial support behind the price, remove it completely.
Restore the original hidden background so it matches the surrounding artwork seamlessly.
The restored area must preserve the natural texture, lighting, gradient, illustration, photo detail, and composition of the original piece.

PRICE REPLACEMENT RULE:
Replace only the price information.
Use {{NEW_PRICE}} as the new value.
Use {{CURRENCY}} only if it is part of the requested final price format.
Do not add any extra words, qualifiers, symbols, prefixes, suffixes, labels, or promotional language unless they are explicitly required by the requested final price.
Do not invent supporting text.

VISUAL INTEGRATION RULE:
The new price must look native to the creative, not pasted on top of it.
It must appear as if the original design had always contained that price.
Maintain a clean, professional, production-ready result with no visible edit marks.

PRESERVATION RULE:
Do not alter any element other than the price area strictly required for the replacement.
Preserve the original: layout, composition, logo, brand elements, headlines, body text, call-to-action elements, icons, illustrations, product imagery, photographic content, spacing, alignment, and visual hierarchy.
Do not move, resize, redesign, reflow, rewrite, or replace any non-price element.

STYLE RULE:
Respect {{STYLE}} while keeping full consistency with the original creative.
The final price must match the intended visual language of the piece without introducing a new text container or artificial support shape.

LANGUAGE RULE:
Respect {{LANGUAGE}} for any price formatting conventions only when explicitly required by the requested final value.
Do not translate unrelated text.
Do not modify the language of any existing copy.

TEXT APPEARANCE RULE:
Keep the new price highly legible, visually balanced, and aligned with the composition.
Match the intended emphasis level of the original price placement without exaggerating it.
Do not introduce unnecessary decorative effects.
Do not distort the typography.
Do not split the price into disconnected parts unless the original composition clearly requires a multi-line treatment.

CLEAN EDIT RULE:
Do not leave: hard edges, masking traces, repaint marks, visible seams, mismatched blur, mismatched grain, mismatched lighting, mismatched shadows, color banding, artificial texture blocks, overlay artifacts, remnants of the old price, or remnants of any old background shape behind the price.

NEGATIVE CONSTRAINTS:
- no box behind the price
- no rectangle behind the price
- no patch behind the price
- no banner behind the price
- no label behind the price
- no sticker effect
- no badge effect
- no text panel
- no highlighted strip
- no opaque support shape
- no background plate
- no covering of nearby design elements
- no redesign of the piece

FINAL QUALITY STANDARD:
The output must look like a natural original version of the same creative with the updated price already built into the design.
The only visible change must be the replacement of the previous price by the new requested price, with the original background fully restored and with no artificial backdrop behind the text.

FAILSAFE RULE:
If the edit cannot be completed naturally, prioritize restoring the original background first.
Never solve the task by placing the new price on top of a colored block, text container, or artificial overlay.`

function fillTemplate(newPrice: string, currency: string, language: string, style: string): string {
  return EDIT_PROMPT_TEMPLATE
    .replaceAll('{{NEW_PRICE}}', newPrice)
    .replaceAll('{{CURRENCY}}', currency)
    .replaceAll('{{LANGUAGE}}', language)
    .replaceAll('{{STYLE}}', style)
}

// Attempt to infer currency from the price string so the caller doesn't need to provide it separately.
function inferCurrency(price: string): string {
  if (/[$]/.test(price)) return '$'
  if (/[€]/.test(price)) return '€'
  if (/[£]/.test(price)) return '£'
  if (/[¥]/.test(price)) return '¥'
  if (/₹/.test(price))   return '₹'
  if (/₿/.test(price))   return 'BTC'
  const isoMatch = price.match(/\b(USD|EUR|GBP|COP|MXN|BRL|CAD|AUD|BTC|ETH|USDT)\b/i)
  if (isoMatch) return isoMatch[1].toUpperCase()
  return 'as shown in the creative'
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY no configurado' }, { status: 500 })
  }

  const body = await req.json() as {
    imageBase64: string
    newPrice: string
    currency?: string
    language?: string
    style?: string
  }

  const { imageBase64, newPrice } = body
  if (!imageBase64) return NextResponse.json({ error: 'imageBase64 requerido' }, { status: 400 })
  if (!newPrice)    return NextResponse.json({ error: 'newPrice requerido' }, { status: 400 })

  const currency = body.currency || inferCurrency(newPrice)
  const language = body.language || 'Spanish'
  const style    = body.style    || 'match the original creative typography and visual style exactly'

  const prompt = fillTemplate(newPrice, currency, language, style)
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')
  const mimeType   = imageBase64.match(/^data:(image\/\w+);base64,/)?.[1] ?? 'image/png'

  try {
    const genAI = new GoogleGenerativeAI(geminiKey)

    // gemini-2.0-flash-exp supports image output when responseModalities includes 'image'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp-image-generation' } as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (model as any).generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: prompt },
        ],
      }],
      generationConfig: { responseModalities: ['image', 'text'] },
    })

    // Extract the image part from the response
    const candidate = result.response.candidates?.[0]
    if (!candidate) {
      return NextResponse.json({ error: 'Gemini no devolvió candidatos' }, { status: 500 })
    }

    const imagePart = candidate.content?.parts?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => p.inlineData?.mimeType?.startsWith('image/')
    )

    if (!imagePart) {
      // Gemini returned text only — image editing not supported for this input
      const textPart = candidate.content?.parts?.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) => p.text
      )
      console.warn('Gemini edit-image: no image in response. Text:', textPart?.text?.slice(0, 200))
      return NextResponse.json(
        { error: 'El modelo no generó una imagen. Intenta con el modo canvas.' },
        { status: 422 }
      )
    }

    const editedBase64 = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`

    return NextResponse.json({ editedImageBase64: editedBase64 })
  } catch (err) {
    console.error('edit-image error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
