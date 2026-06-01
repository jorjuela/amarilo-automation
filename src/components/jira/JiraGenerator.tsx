'use client'

import { useState } from 'react'
import type { JiraOutput } from '@/lib/jira/generator'

interface Project {
  id: string; name: string; city: string; stage: string; monthYear: string | null
}

export default function JiraGenerator({ projects }: { projects: Project[] }) {
  const [selectedProject, setSelectedProject] = useState(projects[0]?.id || '')
  const [output, setOutput] = useState<JiraOutput | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  async function handleGenerate() {
    if (!selectedProject) return
    setLoading(true)
    try {
      const res = await fetch('/api/jira', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject }),
      })
      const data = await res.json()
      setOutput(data)
    } finally {
      setLoading(false)
    }
  }

  async function copyToClipboard(text: string, key: string) {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const project = projects.find((p) => p.id === selectedProject)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card p-5 flex gap-4 items-end">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Proyecto</label>
          <select
            value={selectedProject}
            onChange={(e) => { setSelectedProject(e.target.value); setOutput(null) }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          >
            <option value="">Selecciona un proyecto...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.city} {p.monthYear ? `(${p.monthYear})` : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleGenerate}
          disabled={!selectedProject || loading}
          className="px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-opacity"
          style={{ background: 'var(--amarilo-navy)' }}
        >
          {loading ? 'Generando...' : 'Generar Estructura'}
        </button>
      </div>

      {/* Reference guide */}
      <div className="card p-4 bg-gray-50">
        <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">Convención de Nombres</h3>
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded">ÉPICA</span>
            </div>
            <code className="text-purple-700 font-mono">CIUDAD</code>
            <p className="text-gray-500 mt-1">Ej: MEDELLÍN</p>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="px-1.5 py-0.5 bg-blue-500 text-white text-xs font-bold rounded">TAREA</span>
            </div>
            <code className="text-blue-700 font-mono">PROYECTO-MACRO-CIUDAD-TIPO</code>
            <p className="text-gray-500 mt-1">Ej: ARRAYÁN-JARDINES-DEL-RÍO-MEDELLÍN-NO-VIS</p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg border border-green-100">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="px-1.5 py-0.5 bg-green-500 text-white text-xs font-bold rounded">SUBTAREA</span>
            </div>
            <code className="text-green-700 font-mono">Mes-Proy-Macro-Ciudad-Tema-Tipo</code>
            <p className="text-gray-500 mt-1">Ej: Abr-Arrayán-JardinesRío-Medellín-Meta-NO-VIS</p>
          </div>
        </div>
      </div>

      {output && (
        <div className="space-y-4">
          {/* Copy all button */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Estructura generada para <span className="font-semibold">{project?.name}</span>
            </p>
            <button
              onClick={() => copyToClipboard(output.text, 'all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                copied === 'all'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {copied === 'all' ? '✓ Copiado!' : 'Copiar Todo'}
            </button>
          </div>

          {/* Plain text preview */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
              <span className="text-xs font-medium text-gray-600">Texto para copiar-pegar en Jira</span>
              <button
                onClick={() => copyToClipboard(output.text, 'text')}
                className={`text-xs px-3 py-1 rounded font-medium ${
                  copied === 'text' ? 'bg-green-100 text-green-700' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {copied === 'text' ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-gray-700 overflow-x-auto whitespace-pre-wrap bg-white">
              {output.text}
            </pre>
          </div>

          {/* Visual preview */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Vista previa estructurada</h3>
            {output.epics.map((epic) => (
              <div key={epic.name} className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2.5 py-1 bg-purple-600 text-white text-xs font-bold rounded-full">ÉPICA</span>
                  <span className="text-purple-800 font-bold">{epic.name}</span>
                  <button
                    onClick={() => copyToClipboard(epic.name, `epic-${epic.name}`)}
                    className="text-xs text-purple-400 hover:text-purple-600 ml-1"
                  >
                    {copied === `epic-${epic.name}` ? '✓' : '📋'}
                  </button>
                </div>

                <div className="ml-6 space-y-3">
                  {epic.tasks.map((task) => (
                    <div key={task.name} className="border border-blue-100 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2.5 py-0.5 bg-blue-500 text-white text-xs font-bold rounded-full">TAREA</span>
                        <span className="text-blue-800 font-semibold text-sm">{task.name}</span>
                        <button
                          onClick={() => copyToClipboard(task.name, `task-${task.name}`)}
                          className="text-xs text-blue-400 hover:text-blue-600 ml-1"
                        >
                          {copied === `task-${task.name}` ? '✓' : '📋'}
                        </button>
                      </div>

                      <div className="ml-5 space-y-1.5">
                        {task.subtasks.map((subtask) => (
                          <div key={subtask} className="flex items-center gap-2 py-1 px-3 bg-green-50 rounded-lg">
                            <span className="px-2 py-0.5 bg-green-500 text-white text-xs font-bold rounded-full">SUB</span>
                            <span className="text-green-800 text-xs font-mono flex-1">{subtask}</span>
                            <button
                              onClick={() => copyToClipboard(subtask, `sub-${subtask}`)}
                              className="text-xs text-green-400 hover:text-green-600"
                            >
                              {copied === `sub-${subtask}` ? '✓' : '📋'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length === 0 && (
        <div className="card p-12 text-center text-gray-400">
          <div className="text-4xl mb-3">⚡</div>
          <p className="text-sm">Primero crea un proyecto para generar la estructura Jira</p>
        </div>
      )}
    </div>
  )
}
