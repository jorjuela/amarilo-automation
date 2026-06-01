import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ')

function getRedirectUri(req: NextRequest): string {
  // Build redirect URI from the actual request origin so it always matches
  const host = req.headers.get('host') || 'localhost:3000'
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  return `${proto}://${host}/api/auth/gmail/callback`
}

export async function GET(req: NextRequest) {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  if (!settings) {
    return NextResponse.redirect(new URL('/dashboard/settings?error=no-settings', req.url))
  }

  const config = JSON.parse(settings.data)
  const clientId = config.gmail?.clientId

  if (!clientId) {
    return NextResponse.redirect(new URL('/dashboard/settings?error=no-client-id', req.url))
  }

  const redirectUri = getRedirectUri(req)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return NextResponse.redirect(authUrl)
}
