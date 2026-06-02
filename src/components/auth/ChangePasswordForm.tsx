'use client'

import { useState } from 'react'

export default function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (form.newPassword !== form.confirm) {
      setError('Las contraseñas nuevas no coinciden')
      return
    }
    if (form.newPassword.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Error al cambiar la contraseña')
        return
      }
      setSuccess(true)
      setForm({ currentPassword: '', newPassword: '', confirm: '' })
    } catch {
      setError('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          ✓ Contraseña actualizada correctamente
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Contraseña actual</label>
        <input
          type={showPasswords ? 'text' : 'password'}
          required
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          placeholder="••••••••"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Nueva contraseña</label>
        <input
          type={showPasswords ? 'text' : 'password'}
          required
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          placeholder="Mínimo 8 caracteres"
          minLength={8}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Confirmar nueva contraseña</label>
        <input
          type={showPasswords ? 'text' : 'password'}
          required
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          placeholder="Repite la nueva contraseña"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(e) => setShowPasswords(e.target.checked)}
            className="rounded"
          />
          Mostrar contraseñas
        </label>

        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--amarilo-navy)' }}
        >
          {loading ? 'Guardando...' : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  )
}
