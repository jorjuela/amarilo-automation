export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { Stage } from '@/types'
import type { CampaignDetail, ProjectBlocks } from '@/lib/ai/project-extractor'
import CreateSheetButton from '@/components/projects/CreateSheetButton'
import GenerateJiraButton from '@/components/projects/GenerateJiraButton'
import AutoAssignPanel from '@/components/projects/AutoAssignPanel'
import ProjectTabs from '@/components/projects/ProjectTabs'
import ProjectBlocksView from '@/components/projects/ProjectBlocksView'
import ProjectEditHeader from '@/components/projects/ProjectEditHeader'
import Link from 'next/link'

const TABS = ['overview', 'description', 'campaign', 'traffic', 'jira'] as const
type Tab = typeof TABS[number]

const STAGE_META: Record<Stage, { bg: string; text: string; border: string; dot: string; label: string }> = {
  EXPECTATIVA:   { bg: 'bg-pink-50',   text: 'text-pink-800',   border: 'border-pink-200',   dot: 'bg-pink-500',   label: 'Expectativa'   },
  LANZAMIENTO:   { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-500', label: 'Lanzamiento'   },
  SOSTENIMIENTO: { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200', dot: 'bg-yellow-500', label: 'Sostenimiento' },
}

const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  pending:     { label: 'Pendiente',   bg: 'bg-gray-100',   text: 'text-gray-600',   dot: 'bg-gray-400'   },
  in_progress: { label: 'En progreso', bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  review:      { label: 'En revisión', bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  done:        { label: 'Entregado',   bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500'  },
}

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
  const rawTab = (await searchParams).tab ?? 'overview'
  const tab: Tab = (TABS as readonly string[]).includes(rawTab) ? rawTab as Tab : 'overview'

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
  } catch { notFound() }
  if (!project) notFound()

  const stage = project.stage as Stage
  const sm    = STAGE_META[stage] ?? { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-400', label: stage }

  const totalBudget = project.torres.reduce((s, t) => s + t.budget, 0)
  const totalLeads  = project.torres.reduce((s, t) => s + t.leadGoal, 0)

  let campaign: CampaignDetail | null = null
  if (project.briefData) { try { campaign = JSON.parse(project.briefData) } catch { /* */ } }

  let briefBlocks: ProjectBlocks | null = null
  if ((project as { briefBlocks?: string }).briefBlocks) {
    try { briefBlocks = JSON.parse((project as { briefBlocks?: string }).briefBlocks!) } catch { /* */ }
  }

  // Task counts
  const taskCounts: Record<string, number> = { pending: 0, in_progress: 0, review: 0, done: 0 }
  for (const e of project.trafficEntries) taskCounts[e.status] = (taskCounts[e.status] ?? 0) + 1
  const totalTasks   = project.trafficEntries.length
  const doneTasks    = taskCounts.done ?? 0
  const donePercent  = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
  const pendingTasks = project.trafficEntries.filter((t) => t.status === 'pending' || t.status === 'in_progress').slice(0, 5)

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

  const emailChainSummary = briefBlocks?.emailChainSummary
  const contextBlock = briefBlocks?.blocks.find((b) => b.id === 'context')
  const objectiveBlock = briefBlocks?.blocks.find((b) => b.id === 'objective')
  const audienceBlock  = briefBlocks?.blocks.find((b) => b.id === 'audience')
  const messagesBlock  = briefBlocks?.blocks.find((b) => b.id === 'messages')

  return (
    <div className="p-6 max-w-7xl">
      <Link href="/dashboard/projects" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4">← Proyectos</Link>

      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER SECTION — visible on all tabs
      ═══════════════════════════════════════════════════════════════════════ */}

      {/* Top bar: title + actions */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{project.name}</h1>
            <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${sm.bg} ${sm.text} ${sm.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
              {sm.label}
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">{project.type}</span>
            {project.parseSource === 'AI' && <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 border border-purple-200">🤖 IA</span>}
            {project.needsReview && <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 border border-amber-200">⚠ Revisar</span>}
          </div>
          <p className="text-sm text-gray-500">
            {project.city}{project.city && ' · '}{project.monthYear || 'Sin fecha'} · Registrado {formatDate(project.createdAt)}
            {project.emailReceivedAt && <span> · Email recibido {formatDate(project.emailReceivedAt)}</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <ProjectEditHeader
            projectId={project.id}
            name={project.name}
            macroProject={project.macroProject}
            city={project.city}
            type={project.type}
            stage={project.stage}
            monthYear={project.monthYear}
          />
          <CreateSheetButton projectId={project.id} hasSheet={!!project.googleSheetUrl} sheetUrl={project.googleSheetUrl} />
          <GenerateJiraButton projectId={project.id} />
        </div>
      </div>

      {/* ── Main info panel ── */}
      <div className="grid grid-cols-3 gap-4 mb-4">

        {/* Col 1: Project details + torres */}
        <div className="col-span-1 space-y-3">
          {/* Identity card */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Proyecto</p>
            <div className="space-y-2">
              <Row label="Macroproyecto" value={project.macroProject} />
              <Row label="Ciudad" value={project.city || '—'} />
              <Row label="Tipo" value={project.type} />
              <Row label="Periodo" value={project.monthYear || '—'} />
              {totalLeads > 0 && <Row label="Meta leads/mes" value={totalLeads.toLocaleString()} highlight="blue" />}
              {totalBudget > 0 && <Row label="Presupuesto" value={formatCurrency(totalBudget)} highlight="green" />}
              {project.emailSubject && <Row label="Email origen" value={project.emailSubject} small />}
            </div>
          </div>

          {/* Torres */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Torres / Etapas ({project.torres.length})</p>
            <div className="space-y-2">
              {project.torres.map((t) => {
                const areas: string[] = (() => { try { return JSON.parse(t.areas) } catch { return [] } })()
                return (
                  <div key={t.id} className="flex items-start gap-2 p-2 bg-blue-50 rounded-lg">
                    <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-blue-900">{t.name}</p>
                      {areas.length > 0 && <p className="text-xs text-blue-600">{areas.join(', ')}</p>}
                      <div className="flex gap-2 text-xs text-blue-700 mt-0.5">
                        {t.leadGoal > 0 && <span>{t.leadGoal.toLocaleString()} leads</span>}
                        {t.budget > 0 && <span>{formatCurrency(t.budget)}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Google Sheet */}
          {project.googleSheetUrl && (
            <a href={project.googleSheetUrl} target="_blank" rel="noopener noreferrer"
              className="card p-3 flex items-center gap-2 hover:shadow-md transition-shadow block">
              <span className="text-green-600">📊</span>
              <div><p className="text-xs font-semibold text-gray-800">Google Sheet</p><p className="text-xs text-gray-400">inventario · estatus creatividad</p></div>
              <span className="ml-auto text-xs text-green-600">Abrir →</span>
            </a>
          )}
        </div>

        {/* Col 2: Campaign brief from AI */}
        <div className="col-span-1 space-y-3">
          {/* Email chain summary */}
          {emailChainSummary && (
            <div className="card p-4 border-l-4 border-blue-400">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Resumen del hilo de email</p>
              <p className="text-sm text-gray-700 leading-relaxed">{emailChainSummary}</p>
            </div>
          )}

          {/* Context block */}
          {contextBlock && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{contextBlock.icon} {contextBlock.title}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{contextBlock.content}</p>
              {contextBlock.table && contextBlock.table.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {contextBlock.table.map((r, i) => (
                    <div key={i} className="bg-gray-50 rounded px-2 py-1">
                      <p className="text-xs text-gray-400">{r.label}</p>
                      <p className="text-xs font-semibold text-gray-800">{r.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Objective block */}
          {objectiveBlock && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{objectiveBlock.icon} {objectiveBlock.title}</p>
              <p className="text-sm text-gray-700">{objectiveBlock.content}</p>
              {objectiveBlock.bullets && objectiveBlock.bullets.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {objectiveBlock.bullets.slice(0, 4).map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600"><span className="w-1.5 h-1.5 rounded-full bg-orange-400 mt-1 flex-shrink-0" />{b}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Channels */}
          {campaign?.channels && campaign.channels.length > 0 && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">📡 Canales de pauta</p>
              <div className="flex flex-wrap gap-1.5">
                {campaign.channels.map((c) => (
                  <span key={c} className="px-2.5 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Key messages */}
          {messagesBlock && messagesBlock.bullets && messagesBlock.bullets.length > 0 && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{messagesBlock.icon} {messagesBlock.title}</p>
              <ul className="space-y-1.5">
                {messagesBlock.bullets.slice(0, 5).map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0" />{b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Audience */}
          {audienceBlock && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{audienceBlock.icon} {audienceBlock.title}</p>
              <p className="text-sm text-gray-700">{audienceBlock.content}</p>
            </div>
          )}

          {/* Prompt to generate if no AI data */}
          {!emailChainSummary && !contextBlock && !campaign?.channels?.length && (
            <div className="card p-6 text-center border-2 border-dashed border-gray-200">
              <p className="text-2xl mb-2">🤖</p>
              <p className="text-sm text-gray-500 font-medium">Sin análisis IA aún</p>
              <p className="text-xs text-gray-400 mt-1">Usa "🤖 Generar descripción" en el tab Descripción</p>
            </div>
          )}
        </div>

        {/* Col 3: Task status */}
        <div className="col-span-1 space-y-3">
          {/* Status overview */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Estado de tareas</p>
            {totalTasks === 0 ? (
              <div className="text-center py-4">
                <p className="text-gray-400 text-sm">Sin tareas asignadas</p>
                <p className="text-xs text-gray-300 mt-1">Usa la auto-asignación IA en el tab Resumen</p>
              </div>
            ) : (
              <>
                {/* Progress bar */}
                <div className="flex rounded-full overflow-hidden h-2.5 mb-3 bg-gray-100">
                  {taskCounts.done    > 0 && <div className="bg-green-500 transition-all" style={{ width: `${(taskCounts.done/totalTasks)*100}%` }} />}
                  {taskCounts.review  > 0 && <div className="bg-yellow-400 transition-all" style={{ width: `${(taskCounts.review/totalTasks)*100}%` }} />}
                  {taskCounts.in_progress > 0 && <div className="bg-blue-500 transition-all" style={{ width: `${(taskCounts.in_progress/totalTasks)*100}%` }} />}
                  {taskCounts.pending > 0 && <div className="bg-gray-300 transition-all" style={{ width: `${(taskCounts.pending/totalTasks)*100}%` }} />}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                  <span>{donePercent}% completado</span>
                  <span>{totalTasks} total</span>
                </div>
                {/* Status pills */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {Object.entries(taskCounts).map(([st, n]) => {
                    if (n === 0) return null
                    const m = STATUS_META[st]
                    return (
                      <span key={st} className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${m?.bg} ${m?.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${m?.dot}`} />
                        {m?.label} ({n})
                      </span>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Pending tasks list */}
          {pendingTasks.length > 0 && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Tareas pendientes / en progreso</p>
              <div className="space-y-2">
                {pendingTasks.map((t) => {
                  const m = STATUS_META[t.status]
                  return (
                    <div key={t.id} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50">
                      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${m?.dot ?? 'bg-gray-400'}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{t.requirement}</p>
                        <p className="text-xs text-gray-400">{t.dayOfWeek} · {t.weekLabel}</p>
                        <div className="flex gap-2 mt-0.5">
                          {t.copyName    && <span className="text-xs text-blue-600">✍ {t.copyName}</span>}
                          {t.graphicName && <span className="text-xs text-green-600">🎨 {t.graphicName}</span>}
                        </div>
                      </div>
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs ${m?.bg} ${m?.text}`}>{m?.label}</span>
                    </div>
                  )
                })}
                {totalTasks > 5 && (
                  <Link href={`/dashboard/projects/${project.id}?tab=traffic`} className="block text-center text-xs text-blue-600 hover:text-blue-800 pt-1">
                    Ver todas las tareas ({totalTasks}) →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* RTBs quick view */}
          {campaign?.rtb && campaign.rtb.length > 0 && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">💡 Razones para creer</p>
              <ul className="space-y-1.5">
                {campaign.rtb.slice(0, 4).map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1 flex-shrink-0" />{r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Dos & Donts quick */}
          {(campaign?.dos?.length || campaign?.donts?.length) ? (
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Lineamientos creativos</p>
              {campaign?.dos?.slice(0, 3).map((d, i) => (
                <p key={i} className="text-xs text-green-700 flex items-start gap-1.5 mb-1">
                  <span className="flex-shrink-0">✅</span>{d}
                </p>
              ))}
              {campaign?.donts?.slice(0, 2).map((d, i) => (
                <p key={i} className="text-xs text-red-600 flex items-start gap-1.5 mb-1">
                  <span className="flex-shrink-0">❌</span>{d}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Review banner ── */}
      {project.needsReview && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Requiere revisión manual</p>
            <p className="text-xs text-amber-600 mt-0.5">
              {project.parseSource === 'SUBJECT' ? 'Solo se leyó el asunto del email.' : 'Parser con baja confianza.'}
              {' '}Fuente: <strong>{project.parseSource}</strong> · Confianza: <strong>{project.parseConfidence}</strong>
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          TABS — detail sections
      ═══════════════════════════════════════════════════════════════════════ */}
      <ProjectTabs projectId={id} activeTab={tab} extraTabs={[
        { key: 'description', label: '📝 Descripción' },
        { key: 'campaign',    label: '📣 Campaña'     },
      ]} />

      <div className="mt-6">

        {/* ── RESUMEN ── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {project.emailSubject && (
              <div className="card p-4 border-l-4 border-blue-400">
                <p className="text-xs text-gray-400 font-medium mb-1">Email de origen</p>
                <p className="text-sm font-medium text-gray-800">{project.emailSubject}</p>
                {project.emailReceivedAt && <p className="text-xs text-gray-400 mt-1">Recibido: {formatDate(project.emailReceivedAt)}</p>}
              </div>
            )}
            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-3">Torres / Sub-proyectos</h2>
              <div className="grid grid-cols-2 gap-4">
                {project.torres.map((torre) => {
                  const areas: string[] = (() => { try { return JSON.parse(torre.areas) } catch { return [] } })()
                  let audience = null
                  if (torre.audience) { try { audience = JSON.parse(torre.audience) } catch { /* */ } }
                  return (
                    <div key={torre.id} className="card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-gray-800">{torre.name}</h3>
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">{project.type}</span>
                      </div>
                      <div className="space-y-2">
                        {areas.length > 0 && <div className="flex flex-wrap gap-1">{areas.map((a, i) => <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">{a}</span>)}</div>}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-xs text-gray-400 block">Leads/mes</span><span className="font-semibold">{torre.leadGoal.toLocaleString()}</span></div>
                          <div><span className="text-xs text-gray-400 block">Presupuesto</span><span className="font-semibold">{formatCurrency(torre.budget)}</span></div>
                        </div>
                        {torre.motivo && <p className="text-xs text-gray-500">Motivo: <strong>{torre.motivo}</strong></p>}
                        {torre.ageRange && <p className="text-xs text-gray-500">Rango etario: <strong>{torre.ageRange}</strong></p>}
                        {audience?.motivation && <p className="text-xs text-gray-500">Motivación: {audience.motivation}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-3">Auto-asignación IA</h2>
              <AutoAssignPanel projectId={project.id} hasBrief={(project.briefRawText?.length ?? 0) > 100} />
            </div>
          </div>
        )}

        {/* ── DESCRIPCIÓN ── */}
        {tab === 'description' && (
          <ProjectBlocksView
            projectId={project.id}
            briefBlocks={briefBlocks}
            hasBriefText={(project.briefRawText?.length ?? 0) > 100}
          />
        )}

        {/* ── CAMPAÑA ── */}
        {tab === 'campaign' && (
          <CampaignTab campaign={campaign} />
        )}

        {/* ── TRÁFICO ── */}
        {tab === 'traffic' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div><h2 className="text-base font-semibold text-gray-800">Plan de tráfico</h2><p className="text-xs text-gray-400 mt-0.5">{project.trafficEntries.length} tareas</p></div>
              <Link href={`/dashboard/traffic?projectId=${project.id}`} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">Editar en panel completo →</Link>
            </div>
            {Object.keys(trafficByWeek).length === 0 ? (
              <div className="card p-12 text-center"><p className="text-4xl mb-3">📋</p><p className="text-gray-500">Sin tareas aún</p></div>
            ) : Object.entries(trafficByWeek).map(([weekLabel, entries]) => {
              const ws = entries[0]?.weekStart; const we = entries[0]?.weekEnd
              const exportUrl = ws && we ? `/api/traffic/export?projectId=${project.id}&weekLabel=${encodeURIComponent(weekLabel)}&weekStart=${ws.toISOString().slice(0,10)}&weekEnd=${we.toISOString().slice(0,10)}` : null
              return (
                <div key={weekLabel} className="card overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">{weekLabel}</span>
                      <span className="text-xs text-gray-400">{entries.length} tareas</span>
                      {entries.some((e) => e.aiGenerated) && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">🤖</span>}
                    </div>
                    {exportUrl && <a href={exportUrl} className="text-xs text-green-700 font-medium">↓ Excel</a>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-gray-800 text-white">
                        <th className="px-3 py-2 text-left">Día</th><th className="px-3 py-2 text-left">Requerimiento</th>
                        <th className="px-3 py-2 text-center">#T</th><th className="px-3 py-2 text-center">Copy</th>
                        <th className="px-3 py-2 text-center">#G</th><th className="px-3 py-2 text-center">Gráfico</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {entries.map((e) => {
                          const m = STATUS_META[e.status]
                          return (
                            <tr key={e.id} className="hover:bg-gray-50">
                              <td className="px-3 py-1.5 font-medium whitespace-nowrap">{e.dayOfWeek}</td>
                              <td className="px-3 py-1.5 text-gray-600 max-w-xs truncate">{e.requirement}</td>
                              <td className="px-3 py-1.5 text-center">{e.numTexts || ''}</td>
                              <td className="px-3 py-1.5 text-center">{e.copyName && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{e.copyName}</span>}</td>
                              <td className="px-3 py-1.5 text-center">{e.numGraphics || ''}</td>
                              <td className="px-3 py-1.5 text-center">{e.graphicName && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full">{e.graphicName}</span>}</td>
                              <td className="px-3 py-1.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${m?.bg ?? 'bg-gray-100'} ${m?.text ?? 'text-gray-600'}`}>{m?.label ?? e.status}</span></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── JIRA ── */}
        {tab === 'jira' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Estructura Jira</h2>
              <span className="text-xs text-gray-400">{project.jiraStructures.length} ítems</span>
            </div>
            {Object.keys(jiraByEpic).length === 0 ? (
              <div className="card p-12 text-center"><p className="text-4xl mb-3">🎯</p><p className="text-gray-500">Sin estructura Jira</p><GenerateJiraButton projectId={project.id} /></div>
            ) : Object.entries(jiraByEpic).map(([epic, items]) => (
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
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helper components ────────────────────────────────────────────────────────

function Row({ label, value, highlight, small }: { label: string; value: string; highlight?: 'blue'|'green'; small?: boolean }) {
  const valColor = highlight === 'blue' ? 'text-blue-700 font-semibold' : highlight === 'green' ? 'text-green-700 font-semibold' : 'text-gray-800'
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
      <span className={`text-xs text-right ${valColor} ${small ? 'truncate max-w-[160px]' : ''}`}>{value}</span>
    </div>
  )
}

function CampaignTab({ campaign }: { campaign: CampaignDetail | null }) {
  if (!campaign) return (
    <div className="card p-12 text-center"><p className="text-4xl mb-3">📣</p><p className="text-gray-500">Sin datos de campaña extraídos aún</p></div>
  )

  const SECTION_STYLES: Record<string, { bg: string; title: string; border: string }> = {
    blue:   { bg: 'bg-blue-50',   title: 'text-blue-800',   border: 'border-blue-100' },
    purple: { bg: 'bg-purple-50', title: 'text-purple-800', border: 'border-purple-100' },
    green:  { bg: 'bg-green-50',  title: 'text-green-800',  border: 'border-green-100' },
    red:    { bg: 'bg-red-50',    title: 'text-red-800',    border: 'border-red-100' },
    yellow: { bg: 'bg-yellow-50', title: 'text-yellow-800', border: 'border-yellow-100' },
    orange: { bg: 'bg-orange-50', title: 'text-orange-800', border: 'border-orange-100' },
    gray:   { bg: 'bg-gray-50',   title: 'text-gray-800',   border: 'border-gray-200' },
  }

  function Sec({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
    const s = SECTION_STYLES[color] ?? SECTION_STYLES.gray
    return <div className={`rounded-xl border p-4 ${s.bg} ${s.border}`}><h3 className={`text-sm font-semibold mb-3 ${s.title}`}>{title}</h3>{children}</div>
  }

  function Bullets({ items, dot }: { items: string[]; dot: string }) {
    return <ul className="space-y-1.5">{items.map((it, i) => <li key={i} className="flex items-start gap-2 text-sm text-gray-700"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dot}`} />{it}</li>)}</ul>
  }

  return (
    <div className="space-y-5">
      {campaign.attachmentSummaries?.length > 0 && (
        <Sec title="📎 Adjuntos procesados" color="blue">
          <div className="space-y-3">
            {campaign.attachmentSummaries.map((att, i) => (
              <div key={i} className="bg-blue-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{att.type === 'brief' ? '📄' : att.type === 'media_plan' ? '📊' : '📁'}</span>
                  <div><p className="text-sm font-semibold text-blue-900">{att.filename}</p><span className="text-xs text-blue-500 capitalize">{att.type.replace('_', ' ')}</span></div>
                </div>
                {att.summary && <p className="text-xs text-blue-800 mb-2">{att.summary}</p>}
                {att.keyData?.length > 0 && <ul className="space-y-1">{att.keyData.map((d, j) => <li key={j} className="text-xs text-blue-700 flex items-start gap-1.5"><span className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />{d}</li>)}</ul>}
              </div>
            ))}
          </div>
        </Sec>
      )}
      {campaign.channels?.length > 0 && <Sec title="📡 Canales" color="purple"><div className="flex flex-wrap gap-2">{campaign.channels.map((c) => <span key={c} className="px-3 py-1.5 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">{c}</span>)}</div></Sec>}
      <div className="grid grid-cols-2 gap-4">
        {campaign.objectives?.length > 0 && <Sec title="🎯 Objetivos" color="orange"><Bullets items={campaign.objectives} dot="bg-orange-400" /></Sec>}
        {campaign.kpis?.length > 0 && <Sec title="📊 KPIs" color="green"><Bullets items={campaign.kpis} dot="bg-green-400" /></Sec>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {campaign.targetAudience && <Sec title="👥 Audiencia" color="blue"><p className="text-sm text-blue-800">{campaign.targetAudience}</p></Sec>}
        {campaign.tone && <Sec title="🗣 Tono" color="blue"><p className="text-sm text-blue-800">{campaign.tone}</p></Sec>}
      </div>
      {campaign.rtb?.length > 0 && <Sec title="💡 RTBs" color="yellow"><Bullets items={campaign.rtb} dot="bg-yellow-400" /></Sec>}
      <div className="grid grid-cols-2 gap-4">
        {campaign.dos?.length > 0 && <Sec title="✅ Sí hacer" color="green"><Bullets items={campaign.dos} dot="bg-green-400" /></Sec>}
        {campaign.donts?.length > 0 && <Sec title="❌ No hacer" color="red"><Bullets items={campaign.donts} dot="bg-red-400" /></Sec>}
      </div>
      {campaign.investmentPhases?.length > 0 && <Sec title="🗓 Fases" color="orange"><ol className="space-y-1.5">{campaign.investmentPhases.map((f, i) => <li key={i} className="flex items-start gap-2 text-sm text-orange-800"><span className="w-5 h-5 rounded-full bg-orange-200 text-orange-800 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>{f}</li>)}</ol></Sec>}
      {campaign.learnings?.length > 0 && <Sec title="📚 Aprendizajes" color="gray"><Bullets items={campaign.learnings} dot="bg-gray-400" /></Sec>}
      {campaign.competition && <Sec title="🏁 Competencia" color="gray"><p className="text-sm text-gray-700">{campaign.competition}</p></Sec>}
      {campaign.resources && <Sec title="🗂 Recursos" color="gray"><p className="text-sm text-gray-700">{campaign.resources}</p></Sec>}
      {campaign.salesRoomAddress && <Sec title="📍 Sala de ventas" color="gray"><p className="text-sm text-gray-700">{campaign.salesRoomAddress}</p></Sec>}
    </div>
  )
}
