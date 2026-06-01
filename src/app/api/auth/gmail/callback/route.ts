import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function getRedirectUri(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:3000'
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  return `${proto}://${host}/api/auth/gmail/callback`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings?error=${encodeURIComponent(error)}`, req.url)
    )
  }

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard/settings?error=no-code', req.url))
  }

  // Load client credentials
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  if (!settings) {
    return NextResponse.redirect(new URL('/dashboard/settings?error=no-settings', req.url))
  }

  const config = JSON.parse(settings.data)
  const { clientId, clientSecret } = config.gmail || {}

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=missing-credentials', req.url)
    )
  }

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(req),
      grant_type: 'authorization_code',
    }),
  })

  const tokens = await tokenRes.json()

  if (tokens.error) {
    console.error('Token exchange error:', tokens)
    return NextResponse.redirect(
      new URL(`/dashboard/settings?error=${encodeURIComponent(tokens.error_description || tokens.error)}`, req.url)
    )
  }

  const { refresh_token, access_token } = tokens

  if (!refresh_token) {
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=no-refresh-token-try-revoking', req.url)
    )
  }

  // Save refresh token to settings
  config.gmail.refreshToken = refresh_token
  config.gmail.accessToken = access_token

  // Try to get the user's email
  try {
    const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const profile = await profileRes.json()
    if (profile.emailAddress) {
      config.gmail.email = profile.emailAddress
    }
  } catch {
    // non-critical
  }

  await prisma.settings.update({
    where: { id: 'singleton' },
    data: { data: JSON.stringify(config) },
  })

  return NextResponse.redirect(
    new URL('/dashboard/settings?success=gmail-authorized', req.url)
  )
}
