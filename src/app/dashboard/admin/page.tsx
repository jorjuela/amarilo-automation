export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import UserManagement from '@/components/admin/UserManagement'
import CollaboratorManagement from '@/components/admin/CollaboratorManagement'

export default async function AdminPage() {
  const session = await getSession()
  if (!session || session.role !== 'ADMIN') redirect('/dashboard')

  const [users, collaborators] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.collaborator.findMany({ orderBy: [{ role: 'asc' }, { name: 'asc' }] }),
  ])

  return (
    <div className="p-8 max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Administración</h1>
        <p className="text-sm text-gray-500 mt-1">Usuarios del sistema y equipo creativo</p>
      </div>

      {/* Collaborators */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Equipo creativo</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Colaboradores disponibles para auto-asignación de tráfico (8h/día, festivos Colombia)
          </p>
        </div>
        <CollaboratorManagement initialCollaborators={collaborators} />
      </section>

      {/* Users */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Usuarios del sistema</h2>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} usuario{users.length !== 1 ? 's' : ''} registrado{users.length !== 1 ? 's' : ''}</p>
        </div>
        <UserManagement
          initialUsers={users.map(u => ({ ...u, createdAt: u.createdAt.toISOString() }))}
          currentUserId={session.id}
        />
      </section>
    </div>
  )
}
