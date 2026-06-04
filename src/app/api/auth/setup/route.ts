import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken, makeSessionCookie } from '@/lib/auth'

// Only works if NO users exist (first-run setup)
export async function POST(req: NextRequest) {
  try {
    const count = await prisma.user.count()
    if (count > 0) {
      return NextResponse.json({ error: 'Setup ya completado' }, { status: 403 })
    }

    const { email, password, name } = await req.json()
    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 })
    }

    const hashed = await hashPassword(password)
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), password: hashed, name, role: 'ADMIN' },
    })

    const token = createToken({ id: user.id, email: user.email, name: user.name, role: 'ADMIN' })

    return NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name, role: 'ADMIN' } },
      { headers: { 'Set-Cookie': makeSessionCookie(token) } }
    )
  } catch (err) {
    console.error('[setup POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const count = await prisma.user.count()
    return NextResponse.json({ needsSetup: count === 0 })
  } catch {
    // DB not initialized yet — treat as needs setup
    return NextResponse.json({ needsSetup: true })
  }
}
