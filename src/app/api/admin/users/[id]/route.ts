import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword } from '@/lib/auth'

async function requireAdmin() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  return null
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const err = await requireAdmin()
  if (err) return err

  const { id } = await params
  const { name, role, active, password } = await req.json()

  const data: Record<string, unknown> = {}
  if (name !== undefined) data.name = name
  if (role !== undefined) data.role = role
  if (active !== undefined) data.active = active
  if (password) data.password = await hashPassword(password)

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
  })

  return NextResponse.json(user)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const err = await requireAdmin()
  if (err) return err

  const { id } = await params
  const session = await getSession()

  // Prevent self-deletion
  if (session?.id === id) {
    return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta' }, { status: 400 })
  }

  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
