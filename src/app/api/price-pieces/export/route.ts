import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { html, width = 540, height = 960, filename = 'pieza.png' } = await req.json()

    if (!html) return NextResponse.json({ error: 'HTML requerido' }, { status: 400 })

    const { chromium } = await import('playwright')

    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    try {
      const page = await browser.newPage()
      await page.setViewportSize({ width, height })
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 })

      // Wait for fonts and images to load
      await page.waitForTimeout(800)

      const screenshot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height },
      })

      return new NextResponse(screenshot as unknown as BodyInit, {
        headers: {
          'Content-Type': 'image/png',
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
