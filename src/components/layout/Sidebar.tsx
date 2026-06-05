'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { href: '/dashboard/projects', label: 'Proyectos', icon: '🏗' },
  { href: '/dashboard/traffic', label: 'Tráfico Interno', icon: '📋' },
  { href: '/dashboard/cambio-precio',  label: 'Cambio de Precio', icon: '🎨' },
  { href: '/dashboard/image-editor',   label: 'Editor de Imágenes', icon: '🖼' },
  { href: '/dashboard/jira', label: 'Estructura Jira', icon: '⚡' },
  { href: '/dashboard/settings', label: 'Configuración', icon: '⚙' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {})
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const isAdmin = user?.role === 'ADMIN'

  return (
    <aside
      style={{ background: 'var(--amarilo-navy)' }}
      className="w-64 min-h-screen flex flex-col flex-shrink-0"
    >
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-sm"
            style={{ background: 'var(--amarilo-yellow)', color: 'var(--amarilo-navy)' }}
          >
            A
          </div>
          <div>
            <div className="text-white font-bold text-sm">Amarilo</div>
            <div className="text-white/50 text-xs">Automation</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive ? 'active' : ''}`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}

        {/* Admin section */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1 px-4">
              <p className="text-white/30 text-xs font-semibold uppercase tracking-wider">Admin</p>
            </div>
            <Link
              href="/dashboard/admin"
              className={`sidebar-link ${pathname.startsWith('/dashboard/admin') ? 'active' : ''}`}
            >
              <span className="text-base">👥</span>
              <span>Usuarios</span>
            </Link>
          </>
        )}
      </nav>

      {/* User info + logout */}
      <div className="px-3 py-4 border-t border-white/10 space-y-2">
        {user && (
          <Link
            href="/dashboard/profile"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors ${pathname === '/dashboard/profile' ? 'bg-white/10' : ''}`}
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: 'var(--amarilo-yellow)', color: 'var(--amarilo-navy)' }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-medium truncate">{user.name}</p>
              <p className="text-white/40 text-xs truncate">{user.role === 'ADMIN' ? 'Administrador · Mi cuenta' : 'Usuario · Mi cuenta'}</p>
            </div>
          </Link>
        )}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full sidebar-link hover:bg-red-500/20 text-white/70 hover:text-red-300 transition-colors"
        >
          <span className="text-base">↩</span>
          <span>{loggingOut ? 'Saliendo...' : 'Cerrar sesión'}</span>
        </button>
        <div className="px-3">
          <div className="text-white/25 text-xs">v1.0.0 · WPP Production</div>
        </div>
      </div>
    </aside>
  )
}
