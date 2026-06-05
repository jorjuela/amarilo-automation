'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  projectId: string
  name: string
  macroProject: string
  city: string
  type: string
  stage: string
  monthYear: string | null
}

const STAGES   = ['EXPECTATIVA', 'LANZAMIENTO', 'SOSTENIMIENTO']
const TYPES    = ['VIS', 'NO VIS', 'TOPE VIS', 'VIP', 'VIS DE RENOVACION URBANA', 'LUXURY']
const CITIES   = ['Bogotá', 'Medellín', 'Cartagena', 'Cali', 'Barranquilla', 'Bucaramanga', 'Pereira', 'Manizales', 'Santa Marta', 'Villavicencio', 'Panamá', 'Otro']

export default function ProjectEditHeader({ projectId, name, macroProject, city, type, stage, monthYear }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name, macroProject, city, type, stage, monthYear: monthYear ?? '' })

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, needsReview: false, parseConfidence: 'high' }),
      })
      if (!res.ok) throw new Error('Error al guardar')
      setOpen(false)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1.5 transition-colors"
        title="Editar datos del proyecto"
      >
        ✏️ Editar
      </button>

      {open && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Editar datos del proyecto</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre del proyecto *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })}
                    placeholder="Ej: JARDINES DE MANZANILLO"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 font-medium uppercase"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Macroproyecto</label>
                  <input
                    value={form.macroProject}
                    onChange={(e) => setForm({ ...form, macroProject: e.target.value.toUpperCase() })}
                    placeholder="Nombre del macroproyecto"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ciudad *</label>
                  <select
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
                  >
                    <option value="">Seleccionar ciudad</option>
                    {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value={form.city}>{form.city && !CITIES.includes(form.city) ? form.city : ''}</option>
                  </select>
                  <input
                    value={CITIES.includes(form.city) ? '' : form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    placeholder="O escribe otra ciudad"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Periodo (mes/año)</label>
                  <input
                    value={form.monthYear}
                    onChange={(e) => setForm({ ...form, monthYear: e.target.value.toUpperCase() })}
                    placeholder="Ej: JUNIO2026"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
                  >
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Etapa</label>
                  <select
                    value={form.stage}
                    onChange={(e) => setForm({ ...form, stage: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white"
                  >
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
              >
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
