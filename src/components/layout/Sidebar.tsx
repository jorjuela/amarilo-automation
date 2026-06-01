'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { href: '/dashboard/projects', label: 'Proyectos', icon: '🏗' },
  { href: '/dashboard/traffic', label: 'Tráfico Interno', icon: '📋' },
  { href: '/dashboard/jira', label: 'Estructura Jira', icon: '⚡' },
  { href: '/dashboard/settings', label: 'Configuración', icon: '⚙' },
]

export default function Sidebar() {
  const pathname = usePathname()

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
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-white/10">
        <div className="text-white/40 text-xs">v1.0.0 · WPP Production</div>
      </div>
    </aside>
  )
}
