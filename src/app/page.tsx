import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const count = await prisma.user.count()
  if (count === 0) redirect('/setup')
  redirect('/dashboard')
}
