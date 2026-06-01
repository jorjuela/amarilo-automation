'use client'

import { useState } from 'react'
import { formatDate } from '@/lib/utils'

interface User {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  createdAt: string
}

export default function UserManagement({
  initialUsers, currentUserId,
}: {
  initialUsers: User[]
  currentUserId: string
}) {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'USER' })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setUsers([...users, data])
      setForm({ name: '', email: '', password: '', role: 'USER' })
      setShowNew(false)
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(user: User) {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !user.active }),
    })
    if (res.ok) {
      const updated = await res.json()
      setUsers(users.map(u => u.id === user.id ? updated : u))
    }
  }

  async function changeRole(user: User, role: string) {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      const updated = await res.json()
      setUsers(users.map(u => u.id === user.id ? updated : u))
    }
  }

  async function deleteUser(user: User) {
    if (!confirm(`¿Eliminar a ${user.name}? Esta acción no se puede deshacer.`)) return
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    if (res.ok) setUsers(users.filter(u => u.id !== user.id))
  }

  return (
    <div className="space-y-4">
      {/* User list */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Usuarios del sistema</h2>
          <button
            onClick={() => setShowNew(!showNew)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--amarilo-navy)' }}
          >
            + Nuevo usuario
          </button>
        </div>

        {/* New user form */}
        {showNew && (
          <div className="px-5 py-4 border-b border-gray-100 bg-blue-50">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Crear nuevo usuario</h3>
            {error && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>
            )}
            <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
              <input
                required placeholder="Nombre completo"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
              <input
                required type="email" placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
              <input
                required type="password" placeholder="Contraseña (mín. 8 caracteres)"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                minLength={8}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              >
                <option value="USER">Usuario</option>
                <option value="ADMIN">Administrador</option>
              </select>
              <div className="col-span-2 flex gap-2">
                <button
                  type="submit" disabled={creating}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: 'var(--amarilo-navy)' }}
                >
                  {creating ? 'Creando...' : 'Crear usuario'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNew(false); setError('') }}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Usuario</th>
              <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rol</th>
              <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
              <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Creado</th>
              <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className={`hover:bg-gray-50 ${!user.active ? 'opacity-50' : ''}`}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: user.role === 'ADMIN' ? 'var(--amarilo-navy)' : '#e5e7eb', color: user.role === 'ADMIN' ? 'white' : '#374151' }}
                    >
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{user.name}</p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </div>
                    {user.id === currentUserId && (
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium">Tú</span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3">
                  {user.id === currentUserId ? (
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-semibold">
                      {user.role === 'ADMIN' ? 'Administrador' : 'Usuario'}
                    </span>
                  ) : (
                    <select
                      value={user.role}
                      onChange={(e) => changeRole(user, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                    >
                      <option value="USER">Usuario</option>
                      <option value="ADMIN">Administrador</option>
                    </select>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${user.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {user.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs text-gray-400">
                  {formatDate(user.createdAt)}
                </td>
                <td className="px-5 py-3">
                  {user.id !== currentUserId && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleActive(user)}
                        className="text-xs text-gray-500 hover:text-blue-600 font-medium"
                      >
                        {user.active ? 'Desactivar' : 'Activar'}
                      </button>
                      <span className="text-gray-200">·</span>
                      <button
                        onClick={() => deleteUser(user)}
                        className="text-xs text-red-400 hover:text-red-600 font-medium"
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info card */}
      <div className="card p-4 bg-gray-50 border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Permisos por rol</h3>
        <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
          <div>
            <p className="font-semibold text-gray-800 mb-1">👤 Usuario</p>
            <ul className="space-y-0.5 text-gray-500">
              <li>✓ Ver proyectos</li>
              <li>✓ Gestionar tráfico</li>
              <li>✓ Generar Jira</li>
              <li>✗ Administrar usuarios</li>
              <li>✗ Cambiar configuración</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-800 mb-1">🔑 Administrador</p>
            <ul className="space-y-0.5 text-gray-500">
              <li>✓ Todo lo anterior</li>
              <li>✓ Administrar usuarios</li>
              <li>✓ Cambiar configuración</li>
              <li>✓ Ejecutar cron manual</li>
              <li>✓ Crear Google Sheets</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
