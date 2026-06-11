import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

export const maxDuration = 60

// ─── Schema ───────────────────────────────────────────────────────────────────

interface TextElement {
  id: string
  text: string
  top: number           // % desde arriba
  left: number          // % desde la izquierda
  fontSize: number      // px
  fontWeight?: string
  color: string         // hex
  textAlign?: 'left' | 'center' | 'right'
  textShadow?: string
  letterSpacing?: number
  width?: number        // % — solo para textos multilinea
}

// ─── Prompt minimalista ───────────────────────────────────────────────────────
// Claude sólo genera ~200-400 tokens de JSON en lugar de ~2000-3000 de HTML.
// El HTML se construye localmente en buildHtml() sin consumir tokens de IA.

const PROMPT = `Analiza la imagen publicitaria. Extrae todos los textos visibles.
Devuelve ÚNICAMENTE JSON sin markdown ni texto adicional:

{"elements":[{"id":"ID","text":"texto exacto","top":Y,"left":X,"fontSize":N,"fontWeight":"700","color":"#HEX","textAlign":"center"}]}

IDs permitidos (usa los que aparezcan en la imagen):
precio, smmlv, nombre, tagline, badge, subtitulo, feat1, feat2, feat3, disclaimer

Reglas:
- top/left en % (0-100) de la esquina superior izquierda del texto
- fontSize en px: título grande 32-48, subtítulo 20-28, cuerpo 14-18, legal 10-12
- fontWeight: "400"|"600"|"700"|"800"|"900"
- color: hexadecimal exacto del texto visible
- textAlign: "left"|"center"|"right"
- Responde SOLO el JSON completo`

// ─── HTML constructor (local, cero tokens de IA) ──────────────────────────────

function buildHtml(elements: TextElement[], width: number, height: number): string {
  const valid = elements.filter(
    (el) => el.id && el.text && typeof el.top === 'number' && typeof el.left === 'number' && el.color
  )

  const spans = valid.map((el) => {
    const s: string[] = [
      'position:absolute',
      `top:${el.top}%`,
      `left:${el.left}%`,
      `font-size:${el.fontSize ?? 16}px`,
      `font-weight:${el.fontWeight ?? '400'}`,
      `color:${el.color}`,
      `text-align:${el.textAlign ?? 'left'}`,
      'z-index:1',
    ]
    if (el.width) {
      s.push(`width:${el.width}%`, 'white-space:normal', 'word-break:break-word')
    } else {
      s.push('white-space:nowrap')
    }
    if (el.textShadow)    s.push(`text-shadow:${el.textShadow}`)
    if (el.letterSpacing) s.push(`letter-spacing:${el.letterSpacing}px`)

    return `  <span id="${el.id}" contenteditable="true" style="${s.join(';')}">${el.text}</span>`
  }).join('\n')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${width}px;height:${height}px;overflow:hidden;position:relative;font-family:'Montserrat',Arial,sans-serif}
[contenteditable]:hover{outline:2px dashed rgba(250,189,2,0.7);cursor:text}
[contenteditable]:focus{outline:2px solid #FABD02;outline-offset:1px}
</style>
</head>
<body>
<img id="_bg" src="PLACEHOLDER" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;"/>
${spans}
</body>
</html>`
}

// ─── Parseo seguro del JSON ───────────────────────────────────────────────────

function parseElements(raw: string): TextElement[] {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    // Extraer el JSON aunque venga con texto alrededor
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) return []
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed?.elements) ? parsed.elements : []
  } catch {
    return []
  }
}

// ─── Claude Vision ────────────────────────────────────────────────────────────

async function extractWithClaude(aiImageBase64: string, mimeType: string): Promise<TextElement[]> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const b64 = aiImageBase64.replace(/^data:image\/\w+;base64,/, '')

  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,  // JSON es compacto: ~200-400 tokens en la práctica
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
            data: b64,
          },
        },
        { type: 'text', text: PROMPT },
      ],
    }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text : '{}'
  return parseElements(text)
}

// ─── Gemini Vision (fallback) ────────────────────────────────────────────────

async function extractWithGemini(aiImageBase64: string, mimeType: string): Promise<TextElement[]> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  const b64 = aiImageBase64.replace(/^data:image\/\w+;base64,/, '')

  const result = await model.generateContent([
    { inlineData: { mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: b64 } },
    { text: PROMPT },
  ])

  return parseElements(result.response.text())
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { aiImageBase64, imageBase64, width = 540, height = 960 } = await req.json()
    const img = aiImageBase64 || imageBase64
    if (!img) return NextResponse.json({ error: 'aiImageBase64 requerido' }, { status: 400 })

    const match = img.match(/^data:(image\/[\w+]+);base64,/)
    if (!match) return NextResponse.json({ error: 'Formato de imagen inválido' }, { status: 400 })
    const mimeType = match[1]

    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY
    const hasGemini    = !!process.env.GEMINI_API_KEY

    if (!hasAnthropic && !hasGemini) {
      return NextResponse.json(
        { error: 'Se requiere ANTHROPIC_API_KEY o GEMINI_API_KEY en las variables de entorno.' },
        { status: 500 }
      )
    }

    let elements: TextElement[] = []

    if (hasAnthropic) {
      try {
        elements = await extractWithClaude(img, mimeType)
      } catch (e) {
        console.error('Claude error:', e)
        if (hasGemini) {
          console.log('Fallback a Gemini…')
          elements = await extractWithGemini(img, mimeType)
        } else {
          throw e
        }
      }
    } else {
      elements = await extractWithGemini(img, mimeType)
    }

    // HTML ensamblado localmente — 0 tokens de IA para el boilerplate
    const html = buildHtml(elements, width, height)

    return NextResponse.json({ html, width, height, engine: hasAnthropic ? 'claude' : 'gemini' })
  } catch (error) {
    console.error('to-html error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
