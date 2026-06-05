'use client'

import { useState } from 'react'
import type { ProjectBlocks, ProjectBlock } from '@/lib/ai/project-extractor'

interface Props {
  projectId: string
  briefBlocks: ProjectBlocks | null
  hasBriefText: boolean
}

const BLOCK_COLORS: Record<string, { bg: string; border: string; title: string; icon_bg: string }> = {
  context:    { bg: 'bg-blue-50',    border: 'border-blue-100',    title: 'text-blue-900',    icon_bg: 'bg-blue-100'    },
  objective:  { bg: 'bg-orange-50',  border: 'border-orange-100',  title: 'text-orange-900',  icon_bg: 'bg-orange-100'  },
  audience:   { bg: 'bg-purple-50',  border: 'border-purple-100',  title: 'text-purple-900',  icon_bg: 'bg-purple-100'  },
  strategy:   { bg: 'bg-indigo-50',  border: 'border-indigo-100',  title: 'text-indigo-900',  icon_bg: 'bg-indigo-100'  },
  messages:   { bg: 'bg-yellow-50',  border: 'border-yellow-100',  title: 'text-yellow-900',  icon_bg: 'bg-yellow-100'  },
  guidelines: { bg: 'bg-green-50',   border: 'border-green-100',   title: 'text-green-900',   icon_bg: 'bg-green-100'   },
  timeline:   { bg: 'bg-pink-50',    border: 'border-pink-100',    title: 'text-pink-900',    icon_bg: 'bg-pink-100'    },
  kpis:       { bg: 'bg-teal-50',    border: 'border-teal-100',    title: 'text-teal-900',    icon_bg: 'bg-teal-100'    },
  default:    { bg: 'bg-gray-50',    border: 'border-gray-200',    title: 'text-gray-900',    icon_bg: 'bg-gray-100'    },
}

function BlockCard({ block }: { block: ProjectBlock }) {
  const [expanded, setExpanded] = useState(true)
  const c = BLOCK_COLORS[block.id] ?? BLOCK_COLORS.default
  const hasExtra = (block.bullets?.length ?? 0) > 0 || (block.table?.length ?? 0) > 0

  return (
    <div className={`rounded-xl border p-4 ${c.bg} ${c.border}`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 text-left"
      >
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${c.icon_bg}`}>
          {block.icon}
        </span>
        <span className={`font-bold text-sm flex-1 ${c.title}`}>{block.title}</span>
        <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 ml-12 space-y-3">
          {/* Main content paragraph */}
          {block.content && (
            <p className="text-sm text-gray-700 leading-relaxed">{block.content}</p>
          )}

          {/* Key-value table */}
          {block.table && block.table.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {block.table.map((row, i) => (
                <div key={i} className="bg-white bg-opacity-70 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-400 font-medium">{row.label}</p>
                  <p className="text-sm font-semibold text-gray-800">{row.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Bullet list */}
          {block.bullets && block.bullets.length > 0 && (
            <ul className="space-y-1.5">
              {block.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${c.icon_bg.replace('bg-', 'bg-').replace('-100', '-400')}`} />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProjectBlocksView({ projectId, briefBlocks, hasBriefText }: Props) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/reprocess`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  if (!briefBlocks || briefBlocks.blocks.length === 0) {
    return (
      <div className="space-y-4">
        <div className="card p-10 text-center">
          <p className="text-4xl mb-3">📝</p>
          <p className="text-gray-600 font-medium">Descripción por bloques no generada aún</p>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            {hasBriefText
              ? 'El brief está almacenado. Genera la descripción estructurada con IA.'
              : 'Primero procesa el email/brief para almacenar el contenido.'}
          </p>
          {hasBriefText && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="mt-4 px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2 mx-auto"
            >
              {generating ? (
                <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generando con Gemini…</>
              ) : '🤖 Generar descripción con IA'}
            </button>
          )}
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Email chain summary banner */}
      {briefBlocks.emailChainSummary && (
        <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3">
          <span className="text-xl flex-shrink-0">📧</span>
          <div>
            <p className="text-xs font-semibold text-blue-700 mb-1">Resumen de la cadena de email</p>
            <p className="text-sm text-blue-800">{briefBlocks.emailChainSummary}</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex-shrink-0 ml-auto text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-60"
            title="Re-generar"
          >
            {generating ? '🔄' : '↺ Actualizar'}
          </button>
        </div>
      )}

      {/* Blocks grid: 2 columns on wide screens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {briefBlocks.blocks.map((block) => (
          <BlockCard key={block.id} block={block} />
        ))}
      </div>

      <p className="text-xs text-gray-400 text-right">
        Generado: {new Date(briefBlocks.generatedAt).toLocaleString('es-CO')}
      </p>
    </div>
  )
}
