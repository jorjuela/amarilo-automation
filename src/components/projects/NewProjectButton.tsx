'use client'

import { useState } from 'react'
import type { Stage, ProjectType } from '@/types'

const STAGES: Stage[] = ['EXPECTATIVA', 'LANZAMIENTO', 'SOSTENIMIENTO']
const TYPES: ProjectType[] = ['NO VIS', 'VIS', 'TOPE VIS', 'VIP', 'VIS DE RENOVACION URBANA', 'LUXURY']

export default function NewProjectButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', city: '', type: 'NO VIS' as ProjectType, stage: 'SOSTENIMIENTO' as Stage,
    monthYear: '', macroProject: '',
  })
  const [torres, setTorres] = useState([{ name: '', areas: '', leadGoal: 0, budget: 0 }])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          macroProject: form.macroProject || form.name,
          torres: torres.map((t) => ({
            ...t,
            areas: t.areas.split(',').map((a) => a.trim()).filter(Boolean),
          })),
        }),
      })
      if (res.ok) {
        setOpen(false)
        window.location.reload()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
        style={{ background: 'var(--amarilo-navy)' }}
      >
        + Nuevo Proyecto
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">Nuevo Proyecto</h2>
              <p className="text-sm text-gray-500 mt-0.5">Crear proyecto manualmente</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Nombre del Proyecto *</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej: Jardines del Río"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Macroproyecto</label>
                  <input
                    value={form.macroProject}
                    onChange={(e) => setForm({ ...form, macroProject: e.target.value })}
                    placeholder="Ej: Jardines del Río"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Ciudad *</label>
                  <input
                    required
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    placeholder="Ej: Medellín"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Mes/Año (ej: ABRIL2026)</label>
                  <input
                    value={form.monthYear}
                    onChange={(e) => setForm({ ...form, monthYear: e.target.value.toUpperCase() })}
                    placeholder="ABRIL2026"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as ProjectType })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  >
                    {TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Etapa</label>
                  <select
                    value={form.stage}
                    onChange={(e) => setForm({ ...form, stage: e.target.value as Stage })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  >
                    {STAGES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Torres */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">Torres / Sub-proyectos</label>
                  <button
                    type="button"
                    onClick={() => setTorres([...torres, { name: '', areas: '', leadGoal: 0, budget: 0 }])}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    + Agregar torre
                  </button>
                </div>
                {torres.map((torre, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 mb-2 p-3 bg-gray-50 rounded-lg">
                    <input
                      placeholder="Nombre torre"
                      value={torre.name}
                      onChange={(e) => {
                        const t = [...torres]; t[i].name = e.target.value; setTorres(t)
                      }}
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400"
                    />
                    <input
                      placeholder="Áreas (30m², 45m²)"
                      value={torre.areas}
                      onChange={(e) => {
                        const t = [...torres]; t[i].areas = e.target.value; setTorres(t)
                      }}
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400"
                    />
                    <input
                      type="number"
                      placeholder="Meta leads"
                      value={torre.leadGoal || ''}
                      onChange={(e) => {
                        const t = [...torres]; t[i].leadGoal = parseInt(e.target.value) || 0; setTorres(t)
                      }}
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400"
                    />
                    <input
                      type="number"
                      placeholder="Presupuesto $"
                      value={torre.budget || ''}
                      onChange={(e) => {
                        const t = [...torres]; t[i].budget = parseFloat(e.target.value) || 0; setTorres(t)
                      }}
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: 'var(--amarilo-navy)' }}
                >
                  {loading ? 'Creando...' : 'Crear Proyecto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
