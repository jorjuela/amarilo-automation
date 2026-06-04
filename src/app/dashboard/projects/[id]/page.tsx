export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { Stage } from '@/types'
import CreateSheetButton from '@/components/projects/CreateSheetButton'
import GenerateJiraButton from '@/components/projects/GenerateJiraButton'
import AutoAssignPanel from '@/components/projects/AutoAssignPanel'
import ProjectTabs from '@/components/projects/ProjectTabs'
import Link from 'next/link'

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const { tab = 'overview' } = await searchParams

  let project
  try {
    project = await prisma.project.findUnique({
      where: { id },
      include: {
        torres: true,
        jiraStructures: { orderBy: { createdAt: 'asc' } },
        trafficEntries: { orderBy: [{ weekStart: 'asc' }, { dayOfWeek: 'asc' }] },
      },
    })
  } catch {
    notFound()
  }
  if (!project) notFound()

  const stage = project.stage as Stage
  const stageColors: Record<Stage, string> = {
    EXPECTATIVA:   'bg-pink-100 text-pink-700 border-pink-200',
    LANZAMIENTO:   'bg-orange-100 text-orange-700 border-orange-200',
    SOSTENIMIENTO: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  }

  const totalBudget = project.torres.reduce((s, t) => s + t.budget, 0)
  const totalLeads  = project.torres.reduce((s, t) => s + t.leadGoal, 0)

  // Group jira by epic
  const jiraByEpic: Record<string, typeof project.jiraStructures> = {}
  for (const s of project.jiraStructures) {
    if (!jiraByEpic[s.epic]) jiraByEpic[s.epic] = []
    jiraByEpic[s.epic].push(s)
  }

  // Group traffic by week
  const trafficByWeek: Record<string, typeof project.trafficEntries> = {}
  for (const e of project.trafficEntries) {
    if (!trafficByWeek[e.weekLabel]) trafficByWeek[e.weekLabel] = []
    trafficByWeek[e.weekLabel].push(e)
  }

  const STATUS_LABELS: Record<string, string> = {
    pending: 'Pendiente', in_progress: 'En progreso', review: 'En revisión', done: 'Entregado',
  }
  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    review: 'bg-yellow-100 text-yellow-700',
    done: 'bg-green-100 text-green-700',
  }

  return (
    <div className="p-6 max-w-6xl">
      {/* Back */}
      <Link href="/dashboard/projects" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4">
        ← Proyectos
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${stageColors[stage] ?? 'bg-gray-100 text-gray-600'}`}>
              {stage}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
              {project.type}
            </span>
            {project.trafficEntries.some((e) => e.aiGenerated) && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                🤖 IA activa
              </span>
            )}
          </div>
          <p className="text-gray-500 text-sm">
            {project.city} · {project.monthYear || 'Sin fecha'} · Registrado el {formatDate(project.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <CreateSheetButton projectId={project.id} hasSheet={!!project.googleSheetUrl} sheetUrl={project.googleSheetUrl} />
          <GenerateJiraButton projectId={project.id} />
        </div>
      </div>

      {/* Needs-review banner */}
      {(project as { needsReview?: boolean }).needsReview && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <span className="text-xl flex-shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Este proyecto requiere revisión manual</p>
            <p className="text-xs text-amber-600 mt-0.5">
              El parser extrae la información con baja confianza
              {(project as { parseSource?: string }).parseSource === 'SUBJECT' ? ' — solo se pudo leer el asunto del email' : ''}.
              Verifica que el nombre, ciudad, tipo y etapa sean correctos.
            </p>
            {(project as { parseConfidence?: string }).parseConfidence && (
              <p className="text-xs text-amber-500 mt-1">
                Fuente: <strong>{(project as { parseSource?: string }).parseSource}</strong> · Confianza: <strong>{(project as { parseConfidence?: string }).parseConfidence}</strong>
              </p>
            )}
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">Torres</p>
          <p className="text-2xl font-bold text-gray-900">{project.torres.length}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">Leads/mes</p>
          <p className="text-2xl font-bold text-blue-700">{totalLeads.toLocaleString()}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">Presupuesto</p>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(totalBudget)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">Tareas tráfico</p>
          <p className="text-2xl font-bold text-purple-700">{project.trafficEntries.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <ProjectTabs projectId={id} activeTab={tab} />

      {/* Tab content */}
      <div className="mt-6">

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {/* Email */}
            {project.emailSubject && (
              <div className="card p-4 border-l-4 border-blue-400">
                <p className="text-xs text-gray-400 font-medium mb-1">Email de origen</p>
                <p className="text-sm font-medium text-gray-800">{project.emailSubject}</p>
                {project.emailReceivedAt && (
                  <p className="text-xs text-gray-400 mt-1">Recibido: {formatDate(project.emailReceivedAt)}</p>
                )}
              </div>
            )}

            {/* Torres */}
            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-3">Torres / Sub-proyectos</h2>
              <div className="grid grid-cols-2 gap-4">
                {project.torres.map((torre) => {
                  const areas: string[] = (() => { try { return JSON.parse(torre.areas) } catch { return [] } })()
                  let audience = null
                  if (torre.audience) { try { audience = JSON.parse(torre.audience) } catch { /* ignore */ } }
                  return (
                    <div key={torre.id} className="card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-gray-800">{torre.name}</h3>
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">{project.type}</span>
                      </div>
                      <div className="space-y-2">
                        {areas.length > 0 && (
                          <div>
                            <span className="text-xs text-gray-400">Áreas: </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {areas.map((a: string, i: number) => (
                                <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">{a}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-xs text-gray-400 block">Meta leads/mes</span>
                            <span className="font-semibold text-gray-800">{torre.leadGoal.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-xs text-gray-400 block">Presupuesto</span>
                            <span className="font-semibold text-gray-800">{formatCurrency(torre.budget)}</span>
                          </div>
                        </div>
                        {torre.motivo && (
                          <p className="text-xs text-gray-500">Motivo: <strong>{torre.motivo}</strong></p>
                        )}
                        {torre.ageRange && (
                          <p className="text-xs text-gray-500">Rango etario: <strong>{torre.ageRange}</strong></p>
                        )}
                        {audience && (
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <p className="text-xs font-medium text-gray-500 mb-1">Audiencia</p>
                            {audience.cities?.length > 0 && (
                              <p className="text-xs text-gray-600">Ciudades: {audience.cities.join(', ')}</p>
                            )}
                            {audience.motivation && (
                              <p className="text-xs text-gray-600 mt-0.5">Motivación: {audience.motivation}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Google Sheet */}
            {project.googleSheetUrl && (
              <div className="card p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">Google Sheet: Amarilo-cliente</p>
                  <p className="text-xs text-gray-400 mt-0.5">Tabs: inventario-piezas · estatus-creatividad</p>
                </div>
                <a href={project.googleSheetUrl} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                  Abrir en Google Sheets →
                </a>
              </div>
            )}

            {/* Auto-assign */}
            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-3">Auto-asignación IA</h2>
              <AutoAssignPanel
                projectId={project.id}
                hasBrief={!!project.briefRawText && project.briefRawText.length > 100}
              />
            </div>
          </div>
        )}

        {/* ── TRÁFICO ── */}
        {tab === 'traffic' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-800">Plan de tráfico</h2>
                <p className="text-xs text-gray-400 mt-0.5">{project.trafficEntries.length} tareas asignadas</p>
              </div>
              <Link
                href={`/dashboard/traffic?projectId=${project.id}`}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
              >
                Editar en panel completo →
              </Link>
            </div>

            {Object.keys(trafficByWeek).length === 0 ? (
              <div className="card p-12 text-center">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-gray-500 font-medium">Sin tareas de tráfico aún</p>
                <p className="text-xs text-gray-400 mt-1">Usa la auto-asignación IA en la pestaña Resumen o edita manualmente en el panel de tráfico</p>
              </div>
            ) : (
              Object.entries(trafficByWeek).map(([weekLabel, weekEntries]) => {
                const ws = weekEntries[0]?.weekStart
                const we = weekEntries[0]?.weekEnd
                const exportUrl = ws && we
                  ? `/api/traffic/export?projectId=${project.id}&weekLabel=${encodeURIComponent(weekLabel)}&weekStart=${ws.toISOString().slice(0,10)}&weekEnd=${we.toISOString().slice(0,10)}`
                  : null

                return (
                  <div key={weekLabel} className="card overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">{weekLabel}</span>
                        <span className="text-xs text-gray-400">{weekEntries.length} tareas</span>
                        {weekEntries.some((e) => e.aiGenerated) && (
                          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">🤖 IA</span>
                        )}
                      </div>
                      {exportUrl && (
                        <a href={exportUrl} className="text-xs text-green-700 hover:text-green-800 font-medium flex items-center gap-1">
                          ↓ Excel
                        </a>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-800 text-white">
                            <th className="px-3 py-2 text-left">Día</th>
                            <th className="px-3 py-2 text-left">Requerimiento</th>
                            <th className="px-3 py-2 text-center">#Tex</th>
                            <th className="px-3 py-2 text-center">Copy</th>
                            <th className="px-3 py-2 text-center">#Grf</th>
                            <th className="px-3 py-2 text-center">Gráfico</th>
                            <th className="px-3 py-2 text-center">Hrs</th>
                            <th className="px-3 py-2 text-center">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {weekEntries.map((entry) => (
                            <tr key={entry.id} className="hover:bg-gray-50">
                              <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{entry.dayOfWeek}</td>
                              <td className="px-3 py-1.5 text-gray-600 max-w-xs truncate">{entry.requirement}</td>
                              <td className="px-3 py-1.5 text-center">{entry.numTexts || ''}</td>
                              <td className="px-3 py-1.5 text-center">
                                {entry.copyName && (
                                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{entry.copyName}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-center">{entry.numGraphics || ''}</td>
                              <td className="px-3 py-1.5 text-center">
                                {entry.graphicName && (
                                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full">{entry.graphicName}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-center text-gray-500">{entry.hoursEstimated}h</td>
                              <td className="px-3 py-1.5 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[entry.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                  {STATUS_LABELS[entry.status] ?? entry.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── JIRA ── */}
        {tab === 'jira' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Estructura Jira generada</h2>
              <span className="text-xs text-gray-400">{project.jiraStructures.length} ítems</span>
            </div>
            {Object.keys(jiraByEpic).length === 0 ? (
              <div className="card p-12 text-center">
                <p className="text-4xl mb-3">🎯</p>
                <p className="text-gray-500">Sin estructura Jira aún</p>
                <GenerateJiraButton projectId={project.id} />
              </div>
            ) : (
              Object.entries(jiraByEpic).map(([epic, items]) => (
                <div key={epic} className="card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-0.5 bg-purple-600 text-white text-xs font-bold rounded">ÉPICA</span>
                    <span className="font-semibold text-purple-800">{epic}</span>
                    <span className="text-xs text-gray-400 ml-auto">{items.length} subtareas</span>
                  </div>
                  <div className="space-y-1.5 ml-2">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-start gap-2">
                        <span className="px-1.5 py-0.5 bg-blue-500 text-white text-xs font-bold rounded mt-0.5 flex-shrink-0">T</span>
                        <div>
                          <p className="text-xs font-medium text-gray-700">{item.task}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="px-1.5 py-0.5 bg-green-400 text-white text-xs rounded">S</span>
                            <p className="text-xs text-gray-500">{item.subtask}</p>
                            <span className="text-xs text-gray-300 ml-2">{item.month} · {item.type}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
