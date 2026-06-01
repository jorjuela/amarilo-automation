import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword } from '@/lib/auth'

async function requireAdmin(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  const err = await requireAdmin(req)
  if (err) return err

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const err = await requireAdmin(req)
  if (err) return err

  const { email, password, name, role } = await req.json()

  if (!email || !password || !name) {
    return NextResponse.json({ error: 'Nombre, email y contraseña son requeridos' }, { status: 400 })
  }

  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (exists) {
    return NextResponse.json({ error: 'El email ya está registrado' }, { status: 409 })
  }

  const hashed = await hashPassword(password)
  const user = await prisma.user.create({
    data: { email: email.toLowerCase(), password: hashed, name, role: role || 'USER' },
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
  })

  return NextResponse.json(user, { status: 201 })
}
