import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, comparePassword, hashPassword } from '@/lib/auth'

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { currentPassword, newPassword } = await req.json()

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 })
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } })
  if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

  const valid = await comparePassword(currentPassword, user.password)
  if (!valid) return NextResponse.json({ error: 'La contraseña actual es incorrecta' }, { status: 400 })

  const hashed = await hashPassword(newPassword)
  await prisma.user.update({ where: { id: session.id }, data: { password: hashed } })

  return NextResponse.json({ success: true })
}
