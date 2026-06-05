import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const maxDuration = 60

const PROMPT = `Eres un experto en conversión de imágenes a HTML/CSS pixel-perfect.

Tu tarea: analizar esta imagen publicitaria y generar HTML/CSS que la reproduzca con máxima fidelidad, manteniendo TODOS los elementos visuales y haciendo los textos editables.

INSTRUCCIONES OBLIGATORIAS:

1. ESTRUCTURA BASE:
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: {{W}}px; height: {{H}}px; overflow: hidden; position: relative; }
[contenteditable]:hover { outline: 2px dashed rgba(250,189,2,0.7); cursor: text; }
[contenteditable]:focus { outline: 2px solid #FABD02; outline-offset: 2px; }
</style>
</head>
<body>
  <!-- La imagen original va SIEMPRE como capa base -->
  <img id="_bg" src="{{IMG_SRC}}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;" crossorigin="anonymous"/>

  <!-- Tus capas de texto van aquí con z-index >= 1 -->
</body>
</html>

2. IDENTIFICAR Y RECREAR TODOS LOS TEXTOS como divs con position:absolute encima de la imagen base:
   - Copia exactamente el texto que ves en la imagen
   - Usa las mismas coordenadas aproximadas (top/left como %)
   - Replica tamaño de fuente, peso, color, sombras exactamente
   - font-family: 'Montserrat', Arial, sans-serif (Amarilo usa Montserrat)
   - TODOS los textos deben tener contenteditable="true"

3. IDs ESPECIALES (si los identificas en la imagen):
   - Precio principal → id="precio"
   - Línea SMMLV → id="smmlv"
   - Nombre del proyecto → id="nombre"
   - Frase/tagline → id="tagline"
   - Textos de características (m², parqueadero, etc.) → id="feat1", "feat2", etc.
   - Disclaimer pequeño al pie → id="disclaimer"
   - Logo si es texto → id="logo"
   - Badge/etiqueta (MUY PRONTO, DISPONIBLE, etc.) → id="badge"

4. ELEMENTOS GRÁFICOS (formas, colores sólidos, gradientes):
   - Los divs/shapes decorativos que NO sean texto: recréalos con CSS puro
   - Círculos, rectángulos, ondas con border-radius: úsalos como divs posicionados
   - Gradientes: background: linear-gradient(...)
   - Los logos con iconos: recréalos con CSS o divs si es posible

5. CALIDAD DE POSICIONAMIENTO:
   - Analiza la imagen con cuidado antes de posicionar
   - Usa porcentajes o píxeles según la precisión necesaria
   - Los textos deben quedar encima del mismo texto en la imagen de fondo
   - text-shadow, letter-spacing, line-height: cópialos si los ves

6. RESULTADO: Responde SOLO con el HTML completo (sin bloques markdown, sin texto extra)

La imagen tiene dimensiones: {{W}}x{{H}}px`

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { imageBase64, width = 540, height = 960 } = await req.json()

    if (!imageBase64) return NextResponse.json({ error: 'imageBase64 requerido' }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY no configurada' }, { status: 500 })

    const match = imageBase64.match(/^data:(image\/[\w+]+);base64,(.+)$/)
    if (!match) return NextResponse.json({ error: 'Formato de imagen inválido' }, { status: 400 })
    const [, mimeType, b64data] = match

    const prompt = PROMPT
      .replace(/\{\{W\}\}/g, String(width))
      .replace(/\{\{H\}\}/g, String(height))
      .replace('{{IMG_SRC}}', imageBase64)

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const result = await model.generateContent([
      { inlineData: { mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: b64data } },
      { text: prompt },
    ])

    let html = result.response.text().trim()

    // Strip markdown code fences if present
    html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim()

    if (!html.toLowerCase().startsWith('<!doctype')) {
      html = `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"/></head>\n<body>${html}</body>\n</html>`
    }

    return NextResponse.json({ html, width, height })
  } catch (error) {
    console.error('image-editor/to-html error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
