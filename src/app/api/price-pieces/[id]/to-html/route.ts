import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/auth'
import { GoogleGenerativeAI } from '@google/generative-ai'

const VISION_PROMPT = `Analiza esta pieza publicitaria inmobiliaria de Amarilo y genera un HTML/CSS completo que la reproduzca fielmente para poder editar el precio.

REGLAS OBLIGATORIAS:
1. Retorna SOLO el HTML completo (<!DOCTYPE html>...) sin texto adicional ni bloques de código
2. La imagen original va como <img id="bg" src="{{BG_SRC}}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0">
3. Usa un wrapper: <div id="canvas" style="position:relative;width:{{W}}px;height:{{H}}px;overflow:hidden;font-family:'Montserrat',Arial,sans-serif;">
4. Todo texto sobre la imagen: position:absolute con z-index:1+
5. IMPORTANTE — el elemento del precio debe tener:
   - id="precio"
   - contenteditable="true"
   - style que reproduzca exactamente el color, tamaño y posición original
6. Si hay línea de SMMLV: id="smmlv" contenteditable="true"
7. Si hay nombre del proyecto: id="nombre" contenteditable="true"
8. Si hay tagline/frase: id="tagline" contenteditable="true"
9. Infiere las posiciones (top/left) observando la imagen con precisión
10. Usa colores exactos que ves en la imagen (amarillo Amarilo: #FABD02, azul: #1B3D6B)
11. Agrega este <style> en el <head>:
    [contenteditable]:hover { outline: 2px dashed rgba(250,189,2,0.8); cursor:text; }
    [contenteditable]:focus { outline: 2px solid #FABD02; }
12. Los disclaimers pequeños al pie: id="disclaimer" contenteditable="true"

El resultado debe verse EXACTAMENTE igual a la imagen original cuando se renderiza en un navegador con las mismas dimensiones.`

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const piece = await prisma.pricePiece.findUnique({ where: { id } })
    if (!piece) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!piece.imageBase64) {
      return NextResponse.json({ error: 'La pieza no tiene imagen cargada' }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY no configurada' }, { status: 500 })

    // Detect image dimensions from base64
    const { width: W, height: H } = await getImageDimensions(piece.imageBase64)

    // Extract base64 data and mime type
    const match = piece.imageBase64.match(/^data:(image\/\w+);base64,(.+)$/)
    if (!match) return NextResponse.json({ error: 'Formato de imagen inválido' }, { status: 400 })
    const [, mimeType, base64Data] = match

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const prompt = VISION_PROMPT
      .replace('{{BG_SRC}}', piece.imageBase64)
      .replace('{{W}}', String(W))
      .replace('{{H}}', String(H))

    const result = await model.generateContent([
      { inlineData: { mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: base64Data } },
      { text: prompt },
    ])

    let html = result.response.text().trim()

    // Strip markdown code blocks if present
    html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim()

    // Ensure it starts with <!DOCTYPE
    if (!html.toLowerCase().startsWith('<!doctype')) {
      html = `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"/></head>\n<body>${html}</body>\n</html>`
    }

    // Save the generated HTML to the piece
    await prisma.pricePiece.update({
      where: { id },
      data: { priceConfig: JSON.stringify({ ...JSON.parse(piece.priceConfig || '{}'), generatedHtml: html }) },
    })

    return NextResponse.json({ html, width: W, height: H })
  } catch (error) {
    console.error('to-html error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

async function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  // Decode PNG/JPEG dimensions from base64 header
  try {
    const data = base64.replace(/^data:image\/\w+;base64,/, '')
    const buf  = Buffer.from(data, 'base64')
    if (buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      // PNG: width at bytes 16-19, height at 20-23
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      // JPEG: scan for SOF marker
      let i = 2
      while (i < buf.length) {
        if (buf[i] !== 0xFF) break
        const marker = buf[i + 1]
        if ([0xC0,0xC1,0xC2].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
        }
        i += 2 + buf.readUInt16BE(i + 2)
      }
    }
  } catch { /* fall through */ }
  // Fallback based on format
  return { width: 540, height: 960 }
}
