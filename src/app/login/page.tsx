import LoginForm from '@/components/auth/LoginForm'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const session = await getSession()
  if (session) redirect('/dashboard')

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--amarilo-navy)' }}>
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: 'repeating-linear-gradient(45deg, #FABD02 0, #FABD02 1px, transparent 0, transparent 50%)',
          backgroundSize: '20px 20px',
        }} />
      </div>

      <div className="relative w-full max-w-md mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'var(--amarilo-yellow)' }}>
            <span className="text-2xl font-black" style={{ color: 'var(--amarilo-navy)' }}>A</span>
          </div>
          <h1 className="text-white text-2xl font-bold">Amarilo Automation</h1>
          <p className="text-white/50 text-sm mt-1">WPP Production — Plataforma interna</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Iniciar sesión</h2>
          <p className="text-sm text-gray-400 mb-6">Acceso restringido al equipo autorizado</p>
          <LoginForm />
        </div>

        <p className="text-center text-white/30 text-xs mt-6">
          © 2026 Amarilo · Acceso confidencial
        </p>
      </div>
    </div>
  )
}
