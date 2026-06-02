export const dynamic = 'force-dynamic'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'

export default async function ProfilePage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="p-8 max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mi Cuenta</h1>
        <p className="text-sm text-gray-500 mt-1">Información de tu perfil y seguridad</p>
      </div>

      {/* Profile info */}
      <div className="card p-6 mb-6">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold"
            style={{ background: 'var(--amarilo-navy)', color: 'white' }}
          >
            {session.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{session.name}</p>
            <p className="text-sm text-gray-500">{session.email}</p>
            <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${session.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
              {session.role === 'ADMIN' ? 'Administrador' : 'Usuario'}
            </span>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Cambiar contraseña</h2>
        <p className="text-sm text-gray-400 mb-5">Usa una contraseña segura de al menos 8 caracteres</p>
        <ChangePasswordForm />
      </div>
    </div>
  )
}
