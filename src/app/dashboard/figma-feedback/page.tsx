'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface FeedbackRecord {
  id: string
  createdAt: string
  figmaUrl: string
  frameName: string
  frameId: string
  originalPrice: string
  newPrice: string
  label: 'correct' | 'error'
  errorCategory?: string | null
  description?: string | null
  frameWidth?: number | null
  frameHeight?: number | null
}

interface Stats {
  total: number
  correct: number
  error: number
}

const CATEGORY_LABELS: Record<string, string> = {
  background: 'Fondo de color',
  position: 'Posición incorrecta',
  detection: 'No detectado',
  font: 'Fuente incorrecta',
  other: 'Otro',
}

export default function FigmaFeedbackPage() {
  const [records, setRecords] = useState<FeedbackRecord[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, correct: 0, error: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'correct' | 'error'>('all')

  useEffect(() => {
    fetch('/api/figma/feedback')
      .then((r) => r.json())
      .then((d) => {
        setRecords(d.records ?? [])
        setStats(d.stats ?? { total: 0, correct: 0, error: 0 })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = records.filter((r) => filter === 'all' || r.label === filter)

  const errorByCategory = records
    .filter((r) => r.label === 'error' && r.errorCategory)
    .reduce<Record<string, number>>((acc, r) => {
      const k = r.errorCategory!
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dataset de Feedback — Cambio de Precio Figma</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Casos etiquetados por el equipo para mejorar la generación de imágenes
          </p>
        </div>
        <Link
          href="/dashboard/cambio-precio-figma"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Volver al editor
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total de casos</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{stats.correct}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Correctos
            {stats.total > 0 && (
              <span className="ml-1 text-gray-400">
                ({Math.round((stats.correct / stats.total) * 100)}%)
              </span>
            )}
          </p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{stats.error}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Con errores
            {stats.total > 0 && (
              <span className="ml-1 text-gray-400">
                ({Math.round((stats.error / stats.total) * 100)}%)
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Error breakdown */}
      {Object.keys(errorByCategory).length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-700 mb-3">Tipos de error</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(errorByCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100">
                <span className="text-xs font-medium text-red-700">{CATEGORY_LABELS[cat] ?? cat}</span>
                <span className="text-xs font-bold text-red-500 bg-red-100 rounded-full px-1.5 py-0.5 leading-none">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 pb-0">
        {(['all', 'correct', 'error'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              filter === f
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {f === 'all' ? `Todos (${stats.total})` : f === 'correct' ? `Correctos (${stats.correct})` : `Errores (${stats.error})`}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {stats.total === 0
            ? 'Sin feedback registrado. Genera imágenes en el editor y usa los botones 👍 / 👎.'
            : 'No hay registros con este filtro.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div
              key={r.id}
              className={`card p-4 flex items-start gap-4 ${
                r.label === 'correct' ? 'border-l-4 border-emerald-400' : 'border-l-4 border-red-400'
              }`}
            >
              {/* Verdict badge */}
              <div className="flex-shrink-0 mt-0.5">
                {r.label === 'correct' ? (
                  <span className="text-xl" title="Correcto">👍</span>
                ) : (
                  <span className="text-xl" title="Error">👎</span>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-800 truncate">{r.frameName}</p>
                  <time className="text-[11px] text-gray-400 flex-shrink-0">
                    {new Date(r.createdAt).toLocaleDateString('es-CO', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </time>
                </div>

                <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-600">
                  <span>
                    <span className="text-gray-400">Precio original:</span>{' '}
                    <span className="font-mono font-semibold">{r.originalPrice || '—'}</span>
                  </span>
                  <span className="text-gray-300">→</span>
                  <span>
                    <span className="text-gray-400">Nuevo:</span>{' '}
                    <span className="font-mono font-semibold">{r.newPrice}</span>
                  </span>
                  {r.frameWidth && r.frameHeight && (
                    <span className="text-gray-400 font-mono">
                      {r.frameWidth}×{r.frameHeight}px
                    </span>
                  )}
                </div>

                {r.label === 'error' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.errorCategory && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                        {CATEGORY_LABELS[r.errorCategory] ?? r.errorCategory}
                      </span>
                    )}
                    {r.description && (
                      <span className="text-[11px] text-gray-500 italic">{r.description}</span>
                    )}
                  </div>
                )}

                <div className="mt-1.5">
                  <a
                    href={r.figmaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-blue-500 hover:underline truncate block max-w-xs"
                  >
                    {r.figmaUrl.slice(0, 60)}{r.figmaUrl.length > 60 ? '…' : ''}
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
