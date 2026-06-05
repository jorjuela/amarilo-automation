'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { Stage } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Torre { id: string; name: string; leadGoal: number; budget: number }
interface Task  { id: string; status: string; requirement: string; dayOfWeek: string; weekLabel: string; copyName: string | null; graphicName: string | null }

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
  briefData: string | null
  hasBriefText: boolean
  emailMessageId: string | null
  torres: Torre[]
  tasks: Task[]
}

interface CampaignData {
  channels?: string[]
  objectives?: string[]
  rtb?: string[]
  targetAudience?: string
  tone?: string
  dos?: string[]
  donts?: string[]
  kpis?: string[]
  investmentPhases?: string[]
  resources?: string
  salesRoomAddress?: string
  attachmentSummaries?: { filename: string; summary: string; keyData: string[] }[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_META: Record<Stage, { label: string; dot: string; bg: string; text: string; border: string; icon: string; desc: string }> = {
  EXPECTATIVA:   { label: 'Expectativa',   icon: '🌅', desc: 'Pre-lanzamiento · construyendo audiencia', dot: 'bg-pink-500',   bg: 'bg-pink-50',   text: 'text-pink-700',   border: 'border-pink-200' },
  LANZAMIENTO:   { label: 'Lanzamiento',   icon: '🚀', desc: 'En pauta activa · captando leads',        dot: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  SOSTENIMIENTO: { label: 'Sostenimiento', icon: '📈', desc: 'Campaña continua · optimizando',          dot: 'bg-yellow-500', bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
}

const STAGES: Stage[] = ['EXPECTATIVA', 'LANZAMIENTO', 'SOSTENIMIENTO']

const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  pending:     { label: 'Pendiente',   bg: 'bg-gray-100',   text: 'text-gray-600',  dot: 'bg-gray-400'   },
  in_progress: { label: 'En progreso', bg: 'bg-blue-100',   text: 'text-blue-700',  dot: 'bg-blue-500'   },
  review:      { label: 'En revisión', bg: 'bg-yellow-100', text: 'text-yellow-700',dot: 'bg-yellow-500' },
  done:        { label: 'Entregado',   bg: 'bg-green-100',  text: 'text-green-700', dot: 'bg-green-500'  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBriefData(raw: string | null): CampaignData | null {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function looksLikeId(name: string): boolean {
  return /^[A-Z0-9]{10,}\.[A-Z]{3}$/i.test(name) || /^[a-f0-9]{8,}$/i.test(name)
}

function taskCounts(tasks: Task[]) {
  const counts: Record<string, number> = { pending: 0, in_progress: 0, review: 0, done: 0 }
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
  return counts
}

// ─── Summary Banner ───────────────────────────────────────────────────────────

function SummaryBanner({ projects }: { projects: Project[] }) {
  const totalBudget  = projects.reduce((s, p) => s + p.torres.reduce((a, t) => a + t.budget, 0), 0)
  const totalLeads   = projects.reduce((s, p) => s + p.torres.reduce((a, t) => a + t.leadGoal, 0), 0)
  const totalTasks   = projects.reduce((s, p) => s + p.tasks.length, 0)
  const doneTasks    = projects.reduce((s, p) => s + p.tasks.filter((t) => t.status === 'done').length, 0)
  const pendingTasks = projects.reduce((s, p) => s + p.tasks.filter((t) => t.status === 'pending').length, 0)
  const inProgTasks  = projects.reduce((s, p) => s + p.tasks.filter((t) => t.status === 'in_progress').length, 0)

  // Aggregate channels across all projects
  const allChannels = new Map<string, number>()
  for (const p of projects) {
    const c = parseBriefData(p.briefData)
    for (const ch of c?.channels ?? []) allChannels.set(ch, (allChannels.get(ch) ?? 0) + 1)
  }
  const topChannels = [...allChannels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  // Aggregate RTBs
  const allRtb = new Set<string>()
  for (const p of projects) {
    const c = parseBriefData(p.briefData)
    for (const r of c?.rtb ?? []) allRtb.add(r)
  }

  // Aggregate torres
  const totalTorres = projects.reduce((s, p) => s + p.torres.length, 0)

  // Cities
  const cities = [...new Set(projects.map((p) => p.city).filter(Boolean))]

  const donePercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  if (projects.length === 0) return null

  return (
    <div className="card mb-5 overflow-hidden">
      {/* Top bar */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--amarilo-navy)' }}>
        <div>
          <p className="text-white font-bold text-lg">{projects.length === 1 ? projects[0].name : `${projects.length} proyectos seleccionados`}</p>
          <p className="text-blue-200 text-xs mt-0.5">{cities.join(' · ')}</p>
        </div>
        <div className="flex gap-5 text-right">
          <div>
            <p className="text-blue-200 text-xs">Leads/mes</p>
            <p className="text-white font-bold text-lg">{totalLeads.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-blue-200 text-xs">Presupuesto</p>
            <p className="text-white font-bold text-lg">{formatCurrency(totalBudget)}</p>
          </div>
          <div>
            <p className="text-blue-200 text-xs">Torres</p>
            <p className="text-white font-bold text-lg">{totalTorres}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-gray-100">
        {/* Task status */}
        <div className="p-4">
          <p className="text-xs font-semibold text-gray-500 mb-3">Estado de tareas</p>
          {totalTasks === 0 ? (
            <p className="text-xs text-gray-400">Sin tareas asignadas</p>
          ) : (
            <>
              {/* Progress bar */}
              <div className="flex rounded-full overflow-hidden h-2 mb-3 bg-gray-100">
                {doneTasks  > 0 && <div className="bg-green-500" style={{ width: `${(doneTasks/totalTasks)*100}%` }} />}
                {inProgTasks > 0 && <div className="bg-blue-500" style={{ width: `${(inProgTasks/totalTasks)*100}%` }} />}
                {pendingTasks > 0 && <div className="bg-gray-300" style={{ width: `${(pendingTasks/totalTasks)*100}%` }} />}
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(taskCounts(projects.flatMap((p) => p.tasks))).map(([st, n]) => {
                  if (n === 0) return null
                  const m = STATUS_META[st]
                  return (
                    <span key={st} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m?.bg} ${m?.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${m?.dot}`} />
                      {m?.label ?? st} ({n})
                    </span>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2">{donePercent}% completado · {totalTasks} total</p>
            </>
          )}
        </div>

        {/* Channels */}
        <div className="p-4">
          <p className="text-xs font-semibold text-gray-500 mb-3">Canales activos</p>
          {topChannels.length === 0 ? (
            <p className="text-xs text-gray-400">Sin datos de canales (procesa el brief)</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {topChannels.map(([ch, count]) => (
                <span key={ch} className="px-2.5 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full flex items-center gap-1">
                  {ch}
                  {projects.length > 1 && <span className="text-purple-500 text-xs">×{count}</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* RTBs */}
        <div className="p-4">
          <p className="text-xs font-semibold text-gray-500 mb-3">Razones para creer</p>
          {allRtb.size === 0 ? (
            <p className="text-xs text-gray-400">Sin RTBs extraídos</p>
          ) : (
            <ul className="space-y-1">
              {[...allRtb].slice(0, 4).map((r, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1 flex-shrink-0" />
                  <span className="line-clamp-1">{r}</span>
                </li>
              ))}
              {allRtb.size > 4 && <li className="text-xs text-gray-400">+{allRtb.size - 4} más</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProjectsClient({ projects }: { projects: Project[] }) {
  const [stageFilter, setStageFilter] = useState<Set<Stage>>(new Set())
  const [cityFilter, setCityFilter]   = useState('')
  const [search, setSearch]           = useState('')
  const [reprocessing, setReprocessing] = useState<string | null>(null)

  const cities = useMemo(() => [...new Set(projects.map((p) => p.city).filter(Boolean))].sort(), [projects])

  const filtered = useMemo(() => projects.filter((p) => {
    if (stageFilter.size > 0 && !stageFilter.has(p.stage as Stage)) return false
    if (cityFilter && p.city !== cityFilter) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.macroProject.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [projects, stageFilter, cityFilter, search])

  const byStage = useMemo(() => {
    const map: Record<Stage, Project[]> = { EXPECTATIVA: [], LANZAMIENTO: [], SOSTENIMIENTO: [] }
    for (const p of filtered) { const s = p.stage as Stage; if (map[s]) map[s].push(p) }
    return map
  }, [filtered])

  function toggleStage(s: Stage) {
    setStageFilter((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })
  }

  async function handleReprocess(projectId: string) {
    setReprocessing(projectId)
    try {
      const res = await fetch(`/api/projects/${projectId}/reprocess`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) window.location.reload()
      else alert(`Error al re-procesar: ${data.error}`)
    } catch { /* ignore */ }
    finally { setReprocessing(null) }
  }

  const totalLeads  = filtered.reduce((s, p) => s + p.torres.reduce((a, t) => a + t.leadGoal, 0), 0)
  const totalBudget = filtered.reduce((s, p) => s + p.torres.reduce((a, t) => a + t.budget, 0), 0)

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium text-gray-500 mr-1">Etapa:</span>
          {STAGES.map((s) => {
            const m = STAGE_META[s]; const active = stageFilter.has(s); const count = projects.filter((p) => p.stage === s).length
            return (
              <button key={s} onClick={() => toggleStage(s)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${active ? `${m.bg} ${m.text} ${m.border} shadow-sm` : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>
                <span>{m.icon}</span>{m.label}
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${active ? 'bg-white bg-opacity-60' : 'bg-gray-100'}`}>{count}</span>
              </button>
            )
          })}
          {stageFilter.size > 0 && <button onClick={() => setStageFilter(new Set())} className="text-xs text-gray-400 hover:text-gray-600 underline ml-1">Limpiar</button>}
        </div>
        <div className="flex gap-3 flex-wrap items-center">
          <span className="text-xs font-medium text-gray-500">Filtrar:</span>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white">
            <option value="">Todas las ciudades</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" /></svg>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre de proyecto..." className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
          </div>
          <div className="ml-auto flex gap-4 text-xs text-gray-500">
            <span><strong className="text-gray-800">{filtered.length}</strong> proyectos</span>
            {totalLeads  > 0 && <span><strong className="text-blue-700">{totalLeads.toLocaleString()}</strong> leads/mes</span>}
            {totalBudget > 0 && <span><strong className="text-green-700">{formatCurrency(totalBudget)}</strong></span>}
          </div>
        </div>
      </div>

      {/* Summary banner — always shown above results */}
      {filtered.length > 0 && <SummaryBanner projects={filtered} />}

      {filtered.length === 0 && (
        <div className="card p-16 text-center">
          <p className="text-4xl mb-3">🏗</p>
          <p className="text-gray-500 font-medium">{projects.length === 0 ? 'No hay proyectos aún' : 'Sin resultados para los filtros aplicados'}</p>
        </div>
      )}

      {/* Stage groups */}
      {STAGES.map((stage) => {
        const stagePjs = byStage[stage]
        if (stagePjs.length === 0) return null
        const m = STAGE_META[stage]
        const stageLeads  = stagePjs.reduce((s, p) => s + p.torres.reduce((a, t) => a + t.leadGoal, 0), 0)
        const stageBudget = stagePjs.reduce((s, p) => s + p.torres.reduce((a, t) => a + t.budget, 0), 0)
        return (
          <section key={stage}>
            <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl mb-3 border ${m.bg} ${m.border}`}>
              <div className="flex items-center gap-2">
                <span className="text-lg">{m.icon}</span>
                <div><span className={`font-bold text-sm ${m.text}`}>{m.label}</span><span className="text-xs text-gray-500 ml-2">{m.desc}</span></div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className={`font-semibold ${m.text}`}>{stagePjs.length} proyectos</span>
                {stageLeads  > 0 && <span className="text-gray-500">{stageLeads.toLocaleString()} leads/mes</span>}
                {stageBudget > 0 && <span className="text-gray-500">{formatCurrency(stageBudget)}</span>}
              </div>
            </div>
            <div className="grid gap-3">
              {stagePjs.map((p) => <ProjectCard key={p.id} project={p} stage={stage} onReprocess={handleReprocess} reprocessing={reprocessing} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({ project, stage, onReprocess, reprocessing }: {
  project: Project; stage: Stage
  onReprocess: (id: string) => void
  reprocessing: string | null
}) {
  const m = STAGE_META[stage]
  const totalBudget = project.torres.reduce((s, t) => s + t.budget, 0)
  const totalLeads  = project.torres.reduce((s, t) => s + t.leadGoal, 0)
  const campaign    = parseBriefData(project.briefData)
  const counts      = taskCounts(project.tasks)
  const totalTasks  = project.tasks.length
  const badName     = looksLikeId(project.name)

  return (
    <div className={`card overflow-hidden ${project.needsReview || badName ? 'border-l-4 border-amber-400' : ''}`}>
      {/* Main row */}
      <Link href={`/dashboard/projects/${project.id}`} className="block p-4 hover:bg-gray-50 transition-colors group">
        <div className="flex items-start justify-between gap-4">
          {/* Avatar + name */}
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base flex-shrink-0 group-hover:scale-105 transition-transform" style={{ background: 'var(--amarilo-navy)' }}>
              {project.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className={`font-semibold group-hover:text-blue-700 transition-colors ${badName ? 'text-amber-700' : 'text-gray-900'}`}>
                  {badName ? '⚠ ' : ''}{project.name}
                </h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.bg} ${m.text} border ${m.border}`}>{project.type}</span>
                {project.parseSource === 'AI' && <span className="px-1.5 py-0.5 text-xs bg-purple-50 text-purple-600 rounded">🤖</span>}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{project.city || '—'} · {project.monthYear || 'Sin fecha'} · {formatDate(project.createdAt)}</p>

              {/* Torres */}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {project.torres.slice(0, 5).map((t) => (
                  <span key={t.id} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">{t.name}</span>
                ))}
                {project.torres.length > 5 && <span className="text-xs text-gray-400">+{project.torres.length - 5}</span>}
              </div>

              {/* Channels */}
              {campaign?.channels && campaign.channels.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {campaign.channels.slice(0, 6).map((ch) => (
                    <span key={ch} className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded">{ch}</span>
                  ))}
                  {campaign.channels.length > 6 && <span className="text-xs text-gray-400">+{campaign.channels.length - 6}</span>}
                </div>
              )}
            </div>
          </div>

          {/* KPIs */}
          <div className="flex items-start gap-4 text-right flex-shrink-0">
            {totalLeads > 0 && (
              <div><p className="text-xs text-gray-400">Leads/mes</p><p className="text-sm font-semibold text-blue-700">{totalLeads.toLocaleString()}</p></div>
            )}
            {totalBudget > 0 && (
              <div><p className="text-xs text-gray-400">Presupuesto</p><p className="text-sm font-semibold text-green-700">{formatCurrency(totalBudget)}</p></div>
            )}
            {project.googleSheetUrl && (
              <a href={project.googleSheetUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-0.5 text-xs text-green-600 hover:text-green-700">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-7 3h2v2h-2V6zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm-4-8h2v2H8V6zm0 4h2v2H8v-2zm0 4h2v2H8v-2zm8-8h2v2h-2V6zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2z"/></svg>
                Sheet
              </a>
            )}
          </div>
        </div>
      </Link>

      {/* Task status bar */}
      {totalTasks > 0 && (
        <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-500 font-medium">{totalTasks} tareas:</span>
          {Object.entries(counts).map(([st, n]) => {
            if (n === 0) return null
            const sm = STATUS_META[st]
            return (
              <span key={st} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sm?.bg} ${sm?.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sm?.dot}`} />
                {sm?.label ?? st} ({n})
              </span>
            )
          })}
          {/* Pending task list preview */}
          {project.tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').slice(0, 2).map((t) => (
            <span key={t.id} className="text-xs text-gray-400 truncate max-w-xs">· {t.dayOfWeek} {t.weekLabel}: {t.requirement.slice(0, 40)}{t.requirement.length > 40 ? '…' : ''}</span>
          ))}
        </div>
      )}

      {/* Bad-name / needs-review bar */}
      {(badName || project.needsReview) && (
        <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-700">
            {badName ? 'Nombre no extraído correctamente del brief.' : 'Parseo con baja confianza — verificar datos.'}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            {project.hasBriefText && (
              <button
                onClick={(e) => { e.preventDefault(); onReprocess(project.id) }}
                disabled={reprocessing === project.id}
                className="text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-lg disabled:opacity-60"
              >
                {reprocessing === project.id ? '🔄 Re-procesando…' : '🤖 Re-analizar con IA'}
              </button>
            )}
            <Link href={`/dashboard/projects/${project.id}?tab=overview`} className="text-xs font-medium text-amber-700 underline hover:text-amber-900">
              Ver →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
