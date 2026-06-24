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
      // 'domcontentloaded' avoids waiting for external CDN resources (Google Fonts, etc.)
      // that can block 'networkidle' for 20+ seconds in production Railway containers.
      // The canvas __ready signal handles the actual readiness check below.
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 })

      // Wait for canvas-ready signal (Strategy B: canvas color-sampling)
      const usesCanvas = html.includes('window.__ready')
      if (usesCanvas) {
        await page.waitForFunction(
          () => (window as unknown as Record<string, unknown>).__ready === true,
          { timeout: 12000 },
        ).catch(() => {})
      }

      // Wait for Google Fonts to load (both strategies when fonts are requested)
      const usesFonts = html.includes('fonts.googleapis.com') || html.includes('__fontsReady')
      if (usesFonts) {
        await page.waitForFunction(
          () => (window as unknown as Record<string, unknown>).__fontsReady === true,
          { timeout: 8000 },
        ).catch(() => {}) // non-fatal: falls back to system font if GFonts slow/unavailable
      }

      await page.waitForTimeout(200) // brief settle for final paint

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
