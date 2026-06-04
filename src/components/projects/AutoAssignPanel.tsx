'use client'

import { useState } from 'react'
import { format } from 'date-fns'

interface Props {
  projectId: string
  hasBrief: boolean
}

interface AssignResult {
  message: string
  tasksExtracted: number
  assigned: number
  summary: string
  totalCopyHours: number
  totalGraphicHours: number
}

export default function AutoAssignPanel({ projectId, hasBrief }: Props) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AssignResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [clearExisting, setClearExisting] = useState(false)

  async function runAutoAssign() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/auto-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, clearExisting }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error desconocido')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (!hasBrief) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        No hay texto de brief disponible para analizar. El brief debe ser procesado desde el email primero.
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">🤖</span>
        <div>
          <h3 className="font-semibold text-gray-900">Auto-asignación con IA (Gemini)</h3>
          <p className="text-xs text-gray-500">Analiza el brief y distribuye tareas automáticamente según la carga del equipo</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de inicio</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">Solo días hábiles (excluye fines de semana y festivos Colombia)</p>
        </div>
        <div className="flex flex-col justify-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={clearExisting}
              onChange={(e) => setClearExisting(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <span className="text-sm text-gray-600">Limpiar asignaciones IA anteriores</span>
          </label>
        </div>
      </div>

      <button
        onClick={runAutoAssign}
        disabled={loading}
        className="w-full py-2.5 px-4 bg-blue-600 text-white font-medium rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Analizando brief con Gemini...
          </>
        ) : (
          <>🪄 Analizar brief y auto-asignar tareas</>
        )}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-green-600 text-lg">✅</span>
            <span className="font-medium text-green-800">Asignación completada</span>
          </div>
          {result.summary && <p className="text-sm text-green-700 italic">&ldquo;{result.summary}&rdquo;</p>}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-lg p-3 text-center border border-green-100">
              <p className="text-2xl font-bold text-blue-700">{result.tasksExtracted}</p>
              <p className="text-xs text-gray-500">Tareas extraídas</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center border border-green-100">
              <p className="text-2xl font-bold text-green-700">{result.assigned}</p>
              <p className="text-xs text-gray-500">Tareas asignadas</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center border border-green-100">
              <p className="text-2xl font-bold text-purple-700">
                {(result.totalCopyHours + result.totalGraphicHours).toFixed(0)}h
              </p>
              <p className="text-xs text-gray-500">Horas totales</p>
            </div>
          </div>
          <div className="flex gap-4 text-xs text-gray-600">
            <span>📝 Copy: <strong>{result.totalCopyHours}h</strong></span>
            <span>🎨 Gráfico: <strong>{result.totalGraphicHours}h</strong></span>
          </div>
          <p className="text-xs text-gray-400">Ve a la pestaña Tráfico para ver y editar las asignaciones</p>
        </div>
      )}
    </div>
  )
}
