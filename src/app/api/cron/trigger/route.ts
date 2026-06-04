import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const baseUrl = process.env.NEXTAUTH_URL || `http://localhost:${process.env.PORT || 3000}`
  const cronSecret = process.env.CRON_SECRET

  const headers: Record<string, string> = {}
  if (cronSecret) {
    headers['Authorization'] = `Bearer ${cronSecret}`
  }

  const res = await fetch(`${baseUrl}/api/cron/email`, { headers })
  const data = await res.json()

  // Surface invalid_grant as a specific flag so the UI can show a re-auth prompt
  if (typeof data.error === 'string' && data.error.includes('invalid_grant')) {
    return NextResponse.json(
      { error: data.error, needsReauth: true, message: 'El refresh token de Gmail expiró. Debes re-autorizar desde Configuración.' },
      { status: 401 }
    )
  }

  return NextResponse.json(data, { status: res.status })
}
