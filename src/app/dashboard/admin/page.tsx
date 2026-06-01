export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import UserManagement from '@/components/admin/UserManagement'

export default async function AdminPage() {
  const session = await getSession()
  if (!session || session.role !== 'ADMIN') redirect('/dashboard')

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Administración de Usuarios</h1>
        <p className="text-sm text-gray-500 mt-1">
          {users.length} usuario{users.length !== 1 ? 's' : ''} registrado{users.length !== 1 ? 's' : ''}
        </p>
      </div>

      <UserManagement
        initialUsers={users.map(u => ({ ...u, createdAt: u.createdAt.toISOString() }))}
        currentUserId={session.id}
      />
    </div>
  )
}
