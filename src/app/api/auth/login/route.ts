import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { comparePassword, createToken, makeSessionCookie } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })

    if (!user || !user.active) {
      return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 })
    }

    const valid = await comparePassword(password, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 })
    }

    const token = createToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as 'ADMIN' | 'USER',
    })

    return NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      { headers: { 'Set-Cookie': makeSessionCookie(token) } }
    )
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
