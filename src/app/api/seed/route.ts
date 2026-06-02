// TEMPORARY ENDPOINT — removed after first use
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-seed-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email, password, name, role } = await req.json()
  const hashed = await hashPassword(password)

  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hashed, name, role: role || 'ADMIN', active: true },
    create: { email, password: hashed, name, role: role || 'ADMIN', active: true },
    select: { id: true, email: true, name: true, role: true },
  })

  return NextResponse.json({ ok: true, user })
}
