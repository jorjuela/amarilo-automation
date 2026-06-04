'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { Stage } from '@/types'

interface Torre { id: string; name: string; leadGoal: number; budget: number }
interface Project {
  id: string
  name: string
  macroProject: string
  city: string
  type: string
  stage: string
  status: string
  monthYear: string | null
  createdAt: string | Date
  googleSheetUrl: string | null
  needsReview: boolean
  parseSource: string | null
  torres: Torre[]
}

const STAGE_META: Record<Stage, {
  label: string; dot: string; bg: string; text: string; border: string
  icon: string; desc: string
}> = {
  EXPECTATIVA: {
    label: 'Expectativa', icon: '🌅', desc: 'Pre-lanzamiento · construyendo audiencia',
    dot: 'bg-pink-500', bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200',
  },
  LANZAMIENTO: {
    label: 'Lanzamiento', icon: '🚀', desc: 'En pauta activa · captando leads',
    dot: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200',
  },
  SOSTENIMIENTO: {
    label: 'Sostenimiento', icon: '📈', desc: 'Campaña continua · optimizando',
    dot: 'bg-yellow-500', bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200',
  },
}

const STAGES: Stage[] = ['EXPECTATIVA', 'LANZAMIENTO', 'SOSTENIMIENTO']

export default function ProjectsClient({ projects, onNew }: { projects: Project[]; onNew?: () => void }) {
  const [stageFilter, setStageFilter] = useState<Set<Stage>>(new Set())
  const [cityFilter, setCityFilter]   = useState('')
  const [search, setSearch]           = useState('')

  // Unique sorted cities
  const cities = useMemo(() =>
    [...new Set(projects.map((p) => p.city).filter(Boolean))].sort(),
    [projects]
  )

  // Apply filters
  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (stageFilter.size > 0 && !stageFilter.has(p.stage as Stage)) return false
      if (cityFilter && p.city !== cityFilter) return false
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
          !p.macroProject.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [projects, stageFilter, cityFilter, search])

  // Group by stage
  const byStage = useMemo(() => {
    const map: Record<Stage, Project[]> = { EXPECTATIVA: [], LANZAMIENTO: [], SOSTENIMIENTO: [] }
    for (const p of filtered) {
      const s = p.stage as Stage
      if (map[s]) map[s].push(p)
    }
    return map
  }, [filtered])

  function toggleStage(s: Stage) {
    setStageFilter((prev) => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }

  const totalLeadsAll = filtered.reduce((sum, p) =>
    sum + p.torres.reduce((s, t) => s + t.leadGoal, 0), 0)
  const totalBudgetAll = filtered.reduce((sum, p) =>
    sum + p.torres.reduce((s, t) => s + t.budget, 0), 0)

  return (
    <div className="space-y-6">

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        {/* Stage toggles */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium text-gray-500 mr-1">Etapa:</span>
          {STAGES.map((s) => {
            const m = STAGE_META[s]
            const active = stageFilter.has(s)
            const count = projects.filter((p) => p.stage === s).length
            return (
              <button
                key={s}
                onClick={() => toggleStage(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  active
                    ? `${m.bg} ${m.text} ${m.border} shadow-sm`
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
              >
                <span>{m.icon}</span>
                {m.label}
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${active ? 'bg-white bg-opacity-60' : 'bg-gray-100'}`}>
                  {count}
                </span>
              </button>
            )
          })}
          {stageFilter.size > 0 && (
            <button
              onClick={() => setStageFilter(new Set())}
              className="text-xs text-gray-400 hover:text-gray-600 underline ml-1"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* City + search row */}
        <div className="flex gap-3 flex-wrap items-center">
          <span className="text-xs font-medium text-gray-500">Filtrar:</span>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
          >
            <option value="">Todas las ciudades</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre de proyecto..."
              className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          {/* Summary totals */}
          <div className="ml-auto flex gap-4 text-xs text-gray-500">
            <span><strong className="text-gray-800">{filtered.length}</strong> proyectos</span>
            <span><strong className="text-blue-700">{totalLeadsAll.toLocaleString()}</strong> leads/mes</span>
            <span><strong className="text-green-700">{formatCurrency(totalBudgetAll)}</strong> presupuesto</span>
          </div>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <div className="card p-16 text-center">
          <p className="text-4xl mb-3">🏗</p>
          <p className="text-gray-500 font-medium">
            {projects.length === 0 ? 'No hay proyectos aún' : 'Sin resultados para los filtros aplicados'}
          </p>
          {projects.length === 0 && (
            <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
              Los proyectos se crean automáticamente cuando llega un email con un brief.
            </p>
          )}
        </div>
      )}

      {/* ── Stage groups ────────────────────────────────────────────────────── */}
      {STAGES.map((stage) => {
        const stagePjs = byStage[stage]
        // Hide stages with no results when a stage filter is active
        if (stagePjs.length === 0) return null
        const m = STAGE_META[stage]
        const stageLeads  = stagePjs.reduce((s, p) => s + p.torres.reduce((a, t) => a + t.leadGoal, 0), 0)
        const stageBudget = stagePjs.reduce((s, p) => s + p.torres.reduce((a, t) => a + t.budget, 0), 0)

        return (
          <section key={stage}>
            {/* Stage header */}
            <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl mb-3 border ${m.bg} ${m.border}`}>
              <div className="flex items-center gap-2">
                <span className="text-lg">{m.icon}</span>
                <div>
                  <span className={`font-bold text-sm ${m.text}`}>{m.label}</span>
                  <span className="text-xs text-gray-500 ml-2">{m.desc}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className={`font-semibold ${m.text}`}>{stagePjs.length} proyectos</span>
                <span className="text-gray-500">{stageLeads.toLocaleString()} leads/mes</span>
                <span className="text-gray-500">{formatCurrency(stageBudget)}</span>
              </div>
            </div>

            {/* Project cards */}
            <div className="grid gap-3">
              {stagePjs.map((project) => (
                <ProjectCard key={project.id} project={project} stage={stage} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ProjectCard({ project, stage }: { project: Project; stage: Stage }) {
  const m = STAGE_META[stage]
  const totalBudget = project.torres.reduce((s, t) => s + t.budget, 0)
  const totalLeads  = project.torres.reduce((s, t) => s + t.leadGoal, 0)

  return (
    <Link
      href={`/dashboard/projects/${project.id}`}
      className={`card p-4 hover:shadow-md transition-all block group ${project.needsReview ? 'border-l-4 border-amber-400' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: avatar + info */}
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base flex-shrink-0 group-hover:scale-105 transition-transform"
            style={{ background: 'var(--amarilo-navy)' }}
          >
            {project.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                {project.name}
              </h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.bg} ${m.text} border ${m.border}`}>
                {project.type}
              </span>
              {project.needsReview && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                  ⚠ Revisar
                </span>
              )}
              {project.parseSource === 'AI' && (
                <span className="px-1.5 py-0.5 text-xs bg-purple-50 text-purple-600 rounded">🤖</span>
              )}
            </div>

            {/* City · date · month */}
            <p className="text-xs text-gray-400 mt-0.5">
              {project.city || '—'} · {project.monthYear || 'Sin fecha'} · {formatDate(project.createdAt)}
            </p>

            {/* Torres */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {project.torres.slice(0, 5).map((t) => (
                <span key={t.id} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">
                  {t.name}
                </span>
              ))}
              {project.torres.length > 5 && (
                <span className="text-xs text-gray-400">+{project.torres.length - 5}</span>
              )}
            </div>

            {/* Stage-specific info row */}
            <StageInfo project={project} stage={stage} />
          </div>
        </div>

        {/* Right: KPIs */}
        <div className="flex items-start gap-5 text-right flex-shrink-0">
          {totalLeads > 0 && (
            <div>
              <p className="text-xs text-gray-400">Leads/mes</p>
              <p className="text-sm font-semibold text-blue-700">{totalLeads.toLocaleString()}</p>
            </div>
          )}
          {totalBudget > 0 && (
            <div>
              <p className="text-xs text-gray-400">Presupuesto</p>
              <p className="text-sm font-semibold text-green-700">{formatCurrency(totalBudget)}</p>
            </div>
          )}
          {project.googleSheetUrl && (
            <a
              href={project.googleSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex flex-col items-center gap-0.5 text-xs text-green-600 hover:text-green-700"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-7 3h2v2h-2V6zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm-4-8h2v2H8V6zm0 4h2v2H8v-2zm0 4h2v2H8v-2zm8-8h2v2h-2V6zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2z"/></svg>
              Sheet
            </a>
          )}
        </div>
      </div>
    </Link>
  )
}

// Shows different information depending on the project stage
function StageInfo({ project, stage }: { project: Project; stage: Stage }) {
  if (stage === 'EXPECTATIVA') {
    return (
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-pink-400" />
          Pre-lanzamiento
        </span>
        {project.monthYear && (
          <span>Inicio estimado: <strong className="text-gray-700">{project.monthYear}</strong></span>
        )}
      </div>
    )
  }

  if (stage === 'LANZAMIENTO') {
    const totalLeads = project.torres.reduce((s, t) => s + t.leadGoal, 0)
    return (
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
          Campaña activa
        </span>
        {totalLeads > 0 && (
          <span>Meta: <strong className="text-orange-700">{totalLeads.toLocaleString()} leads</strong></span>
        )}
      </div>
    )
  }

  if (stage === 'SOSTENIMIENTO') {
    const totalBudget = project.torres.reduce((s, t) => s + t.budget, 0)
    return (
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
          Sostenimiento
        </span>
        {totalBudget > 0 && (
          <span>Budget activo: <strong className="text-yellow-700">{formatCurrency(totalBudget)}</strong></span>
        )}
      </div>
    )
  }

  return null
}
