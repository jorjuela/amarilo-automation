'use client'

import { useState } from 'react'

interface Collaborator {
  id: string
  name: string
  role: string
  color: string
  active: boolean
}

const ROLE_OPTIONS = [
  { value: 'COPY',     label: 'Copy / Redacción',  bg: 'bg-blue-100',   text: 'text-blue-800'   },
  { value: 'GRAFICO',  label: 'Gráfico / Diseño',  bg: 'bg-green-100',  text: 'text-green-800'  },
  { value: 'ESTRATEGA',label: 'Estratega',          bg: 'bg-purple-100', text: 'text-purple-800' },
]

const COLOR_PRESETS = [
  '#6B7280','#3B82F6','#10B981','#F59E0B','#EF4444',
  '#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1',
]

const EMPTY: Omit<Collaborator, 'id'> = { name: '', role: 'COPY', color: '#6B7280', active: true }

export default function CollaboratorManagement({ initialCollaborators }: { initialCollaborators: Collaborator[] }) {
  const [collabs, setCollabs] = useState<Collaborator[]>(initialCollaborators)
  const [form, setForm]       = useState<Omit<Collaborator, 'id'>>(EMPTY)
  const [editId, setEditId]   = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const byRole = (role: string) => collabs.filter((c) => c.role === role)

  async function handleSave() {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }
    setSaving(true); setError(null)
    try {
      if (editId) {
        const res = await fetch('/api/collaborators', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editId, ...form }),
        })
        const updated = await res.json()
        setCollabs((prev) => prev.map((c) => c.id === editId ? updated : c))
      } else {
        const res = await fetch('/api/collaborators', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al crear'); }
        const created = await res.json()
        setCollabs((prev) => [...prev, created])
      }
      setForm(EMPTY); setEditId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(collab: Collaborator) {
    const res = await fetch('/api/collaborators', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: collab.id, active: !collab.active }),
    })
    const updated = await res.json()
    setCollabs((prev) => prev.map((c) => c.id === collab.id ? updated : c))
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar colaborador?')) return
    await fetch(`/api/collaborators?id=${id}`, { method: 'DELETE' })
    setCollabs((prev) => prev.filter((c) => c.id !== id))
  }

  function startEdit(c: Collaborator) {
    setEditId(c.id)
    setForm({ name: c.name, role: c.role, color: c.color, active: c.active })
  }

  return (
    <div className="space-y-6">
      {/* Add / Edit form */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{editId ? 'Editar colaborador' : 'Agregar colaborador'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Jaime, Carlos, Laura G"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rol</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
            >
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Color de chip</label>
            <div className="flex gap-2 flex-wrap">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${form.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer border border-gray-200"
                title="Color personalizado"
              />
            </div>
          </div>
          <div className="flex items-end gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Agregar'}
            </button>
            {editId && (
              <button onClick={() => { setEditId(null); setForm(EMPTY) }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                Cancelar
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {/* Collaborator list grouped by role */}
      {ROLE_OPTIONS.map((roleOpt) => {
        const members = byRole(roleOpt.value)
        if (members.length === 0 && !editId) return null
        return (
          <div key={roleOpt.value}>
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-3 ${roleOpt.bg} ${roleOpt.text}`}>
              {roleOpt.label} · {members.length}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {members.map((c) => (
                <div key={c.id} className={`card p-3 flex items-center gap-3 ${!c.active ? 'opacity-50' : ''}`}>
                  <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: c.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.active ? 'Activo' : 'Inactivo'}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(c)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="Editar">✏️</button>
                    <button onClick={() => handleToggleActive(c)} className="p-1.5 text-gray-400 hover:text-yellow-600 rounded" title={c.active ? 'Desactivar' : 'Activar'}>
                      {c.active ? '⏸' : '▶️'}
                    </button>
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Eliminar">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {collabs.length === 0 && (
        <div className="card p-8 text-center text-gray-400 text-sm">
          Sin colaboradores. Agrega al equipo para habilitar la auto-asignación de tráfico.
        </div>
      )}
    </div>
  )
}
