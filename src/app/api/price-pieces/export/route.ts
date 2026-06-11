import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const {
      html,
      width    = 540,
      height   = 960,
      filename = 'pieza.png',
      format   = 'png',   // 'png' | 'jpeg'
      quality  = 92,      // for jpeg
    } = await req.json()

    if (!html) return NextResponse.json({ error: 'HTML requerido' }, { status: 400 })

    const { chromium } = await import('playwright')
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    try {
      const page = await browser.newPage()
      await page.setViewportSize({ width, height })
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 20000 })
      // If HTML uses canvas + __ready signal, wait for it; otherwise fixed timeout for fonts
      const usesCanvas = html.includes('window.__ready')
      if (usesCanvas) {
        await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__ready === true, { timeout: 10000 }).catch(() => {})
      }
      await page.waitForTimeout(600)   // wait for fonts / base64 images to render

      const imgFormat = format === 'jpeg' ? 'jpeg' : 'png'
      const screenshot = await page.screenshot({
        type: imgFormat,
        ...(imgFormat === 'jpeg' ? { quality } : {}),
        clip: { x: 0, y: 0, width, height },
      })

      const mimeType = imgFormat === 'jpeg' ? 'image/jpeg' : 'image/png'
      return new NextResponse(screenshot as unknown as BodyInit, {
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(screenshot.length),
        },
      })
    } finally {
      await browser.close()
    }
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
