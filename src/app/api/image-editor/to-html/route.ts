import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

export const maxDuration = 60

const PROMPT = `Analiza esta imagen publicitaria y genera HTML/CSS que la reproduzca con máxima fidelidad, dejando todos los textos editables.

REGLAS OBLIGATORIAS:

1. ESTRUCTURA:
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: {{W}}px; height: {{H}}px; overflow: hidden; position: relative; font-family: 'Montserrat', Arial, sans-serif; }
[contenteditable]:hover { outline: 2px dashed rgba(250,189,2,0.8); cursor: text; }
[contenteditable]:focus { outline: 2px solid #FABD02; outline-offset: 1px; }
</style>
</head>
<body>
  <img id="_bg" src="{{IMG_SRC}}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;" />
  <!-- textos aquí con z-index >= 1 -->
</body>
</html>

2. IDENTIFICA Y RECREA CADA TEXTO visible en la imagen:
   - Usa position:absolute con coordenadas precisas (top/left como %)
   - Replica exactamente: font-size, font-weight, color, text-shadow, letter-spacing
   - TODOS con contenteditable="true"
   - z-index mínimo: 1

3. IDs ESPECIALES según el contenido detectado:
   - Precio principal → id="precio"
   - SMMLV / precio en salarios mínimos → id="smmlv"
   - Nombre del proyecto → id="nombre"
   - Frase/eslogan → id="tagline"
   - Badge (MUY PRONTO, DISPONIBLE, etc.) → id="badge"
   - Subtítulo o texto de ciudad → id="subtitulo"
   - Características (m², balcón, etc.) → id="feat1", id="feat2", id="feat3"
   - Disclaimer al pie → id="disclaimer"

4. Para formas decorativas (rectángulos de color, círculos, ondas):
   - Recréalos con divs CSS puros si es posible
   - Si son complejos, déjalos cubiertos por la imagen base

5. Analiza cuidadosamente ANTES de posicionar:
   - Las coordenadas deben coincidir con el texto en la imagen
   - Un texto a mitad de la imagen → top: ~50%
   - Un texto al fondo → top: ~80-90%

6. Responde ÚNICAMENTE con el HTML completo. Sin markdown, sin explicaciones.`

// ── Claude Vision (Anthropic) ─────────────────────────────────────────────────

async function convertWithClaude(imageBase64: string, mimeType: string, width: number, height: number): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = PROMPT
    .replace(/\{\{W\}\}/g, String(width))
    .replace(/\{\{H\}\}/g, String(height))
    .replace('{{IMG_SRC}}', imageBase64)

  const b64data = imageBase64.replace(/^data:image\/\w+;base64,/, '')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: b64data,
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return text.trim()
}

// ── Gemini Vision (Google) ────────────────────────────────────────────────────

async function convertWithGemini(imageBase64: string, mimeType: string, width: number, height: number): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const prompt = PROMPT
    .replace(/\{\{W\}\}/g, String(width))
    .replace(/\{\{H\}\}/g, String(height))
    .replace('{{IMG_SRC}}', imageBase64)

  const b64data = imageBase64.replace(/^data:image\/\w+;base64,/, '')

  const result = await model.generateContent([
    { inlineData: { mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: b64data } },
    { text: prompt },
  ])

  return result.response.text().trim()
}

// ── Clean and validate HTML output ────────────────────────────────────────────

function cleanHtml(raw: string, imageBase64: string): string {
  // Strip markdown code fences
  let html = raw.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim()

  // Ensure DOCTYPE
  if (!html.toLowerCase().startsWith('<!doctype')) {
    html = `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"/></head>\n<body>${html}</body>\n</html>`
  }

  // If the AI didn't include the background image, inject it
  if (!html.includes('id="_bg"') && !html.includes('_bg')) {
    html = html.replace(
      '<body>',
      `<body>\n  <img id="_bg" src="${imageBase64}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;" />`
    )
  }

  return html
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { imageBase64, width = 540, height = 960 } = await req.json()
    if (!imageBase64) return NextResponse.json({ error: 'imageBase64 requerido' }, { status: 400 })

    const match = imageBase64.match(/^data:(image\/[\w+]+);base64,/)
    if (!match) return NextResponse.json({ error: 'Formato de imagen inválido' }, { status: 400 })
    const mimeType = match[1]

    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY
    const hasGemini    = !!process.env.GEMINI_API_KEY

    if (!hasAnthropic && !hasGemini) {
      return NextResponse.json({
        error: 'Se requiere ANTHROPIC_API_KEY o GEMINI_API_KEY. Configúrala en Variables de entorno en Railway.',
      }, { status: 500 })
    }

    let rawHtml = ''

    // Try Claude first (better quality), then Gemini as fallback
    if (hasAnthropic) {
      try {
        rawHtml = await convertWithClaude(imageBase64, mimeType, width, height)
      } catch (claudeErr) {
        console.error('Claude error:', claudeErr)
        if (hasGemini) {
          console.log('Falling back to Gemini…')
          rawHtml = await convertWithGemini(imageBase64, mimeType, width, height)
        } else {
          throw claudeErr
        }
      }
    } else {
      rawHtml = await convertWithGemini(imageBase64, mimeType, width, height)
    }

    const html = cleanHtml(rawHtml, imageBase64)

    return NextResponse.json({ html, width, height, engine: hasAnthropic ? 'claude' : 'gemini' })
  } catch (error) {
    console.error('to-html error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
