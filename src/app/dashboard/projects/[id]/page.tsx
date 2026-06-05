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
import Link from 'next/link'

const TABS = ['overview', 'description', 'campaign', 'traffic', 'jira'] as const
type Tab = typeof TABS[number]

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
  const stageColors: Record<Stage, string> = {
    EXPECTATIVA:   'bg-pink-100 text-pink-700 border-pink-200',
    LANZAMIENTO:   'bg-orange-100 text-orange-700 border-orange-200',
    SOSTENIMIENTO: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  }

  const totalBudget = project.torres.reduce((s, t) => s + t.budget, 0)
  const totalLeads  = project.torres.reduce((s, t) => s + t.leadGoal, 0)

  let campaign: CampaignDetail | null = null
  if (project.briefData) {
    try { campaign = JSON.parse(project.briefData) } catch { /* ignore */ }
  }

  let briefBlocks: ProjectBlocks | null = null
  if ((project as { briefBlocks?: string }).briefBlocks) {
    try { briefBlocks = JSON.parse((project as { briefBlocks?: string }).briefBlocks!) } catch { /* ignore */ }
  }

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

  const STATUS_LABELS: Record<string, string> = { pending: 'Pendiente', in_progress: 'En progreso', review: 'En revisión', done: 'Entregado' }
  const STATUS_COLORS: Record<string, string> = { pending: 'bg-gray-100 text-gray-600', in_progress: 'bg-blue-100 text-blue-700', review: 'bg-yellow-100 text-yellow-700', done: 'bg-green-100 text-green-700' }

  return (
    <div className="p-6 max-w-6xl">
      <Link href="/dashboard/projects" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4">← Proyectos</Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${stageColors[stage] ?? 'bg-gray-100 text-gray-600'}`}>{stage}</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">{project.type}</span>
            {project.parseSource === 'AI' && <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 border border-purple-200">🤖 IA</span>}
          </div>
          <p className="text-gray-500 text-sm">{project.city} · {project.monthYear || 'Sin fecha'} · {formatDate(project.createdAt)}</p>
        </div>
        <div className="flex gap-2">
          <CreateSheetButton projectId={project.id} hasSheet={!!project.googleSheetUrl} sheetUrl={project.googleSheetUrl} />
          <GenerateJiraButton projectId={project.id} />
        </div>
      </div>

      {/* Review banner */}
      {project.needsReview && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Requiere revisión manual</p>
            <p className="text-xs text-amber-600 mt-0.5">
              {project.parseSource === 'SUBJECT' ? 'Solo se leyó el asunto del email.' : 'El parser tuvo baja confianza.'}
              {' '}Verifica nombre, ciudad, tipo y etapa.
            </p>
            <p className="text-xs text-amber-500 mt-0.5">Fuente: <strong>{project.parseSource}</strong> · Confianza: <strong>{project.parseConfidence}</strong></p>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Torres', value: project.torres.length, color: 'text-gray-900' },
          { label: 'Leads/mes', value: totalLeads.toLocaleString(), color: 'text-blue-700' },
          { label: 'Presupuesto', value: formatCurrency(totalBudget), color: 'text-green-700' },
          { label: 'Tareas tráfico', value: project.trafficEntries.length, color: 'text-purple-700' },
        ].map((k) => (
          <div key={k.label} className="card p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">{k.label}</p>
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <ProjectTabs projectId={id} activeTab={tab} extraTabs={[
        { key: 'description', label: '📝 Descripción' },
        { key: 'campaign',    label: '📣 Campaña'     },
      ]} />

      <div className="mt-6">

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {project.emailSubject && (
              <div className="card p-4 border-l-4 border-blue-400">
                <p className="text-xs text-gray-400 font-medium mb-1">Email de origen</p>
                <p className="text-sm font-medium text-gray-800">{project.emailSubject}</p>
                {project.emailReceivedAt && <p className="text-xs text-gray-400 mt-1">Recibido: {formatDate(project.emailReceivedAt)}</p>}
              </div>
            )}

            {/* Torres grid */}
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
                        {areas.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {areas.map((a, i) => <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">{a}</span>)}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-xs text-gray-400 block">Leads/mes</span><span className="font-semibold">{torre.leadGoal.toLocaleString()}</span></div>
                          <div><span className="text-xs text-gray-400 block">Presupuesto</span><span className="font-semibold">{formatCurrency(torre.budget)}</span></div>
                        </div>
                        {torre.motivo   && <p className="text-xs text-gray-500">Motivo: <strong>{torre.motivo}</strong></p>}
                        {torre.ageRange && <p className="text-xs text-gray-500">Rango etario: <strong>{torre.ageRange}</strong></p>}
                        {audience?.motivation && <p className="text-xs text-gray-500">Motivación: {audience.motivation}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {project.googleSheetUrl && (
              <div className="card p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">Google Sheet creado</p>
                  <p className="text-xs text-gray-400 mt-0.5">inventario-piezas · estatus-creatividad</p>
                </div>
                <a href={project.googleSheetUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">Abrir →</a>
              </div>
            )}

            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-3">Auto-asignación IA</h2>
              <AutoAssignPanel projectId={project.id} hasBrief={!!project.briefRawText && project.briefRawText.length > 100} />
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
          <div className="space-y-5">
            {!campaign ? (
              <div className="card p-12 text-center">
                <p className="text-4xl mb-3">📣</p>
                <p className="text-gray-500 font-medium">Sin datos de campaña extraídos aún</p>
                <p className="text-xs text-gray-400 mt-1">El cron procesará el brief y guardará la info de campaña la próxima vez que se ejecute</p>
              </div>
            ) : (
              <>
                {/* Adjuntos */}
                {campaign.attachmentSummaries?.length > 0 && (
                  <Section title="📎 Adjuntos procesados" color="blue">
                    <div className="space-y-3">
                      {campaign.attachmentSummaries.map((att, i) => (
                        <div key={i} className="bg-blue-50 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg">{att.type === 'brief' ? '📄' : att.type === 'media_plan' ? '📊' : att.type === 'creative' ? '🎨' : '📁'}</span>
                            <div>
                              <p className="text-sm font-semibold text-blue-900">{att.filename}</p>
                              <span className="text-xs text-blue-500 capitalize">{att.type.replace('_', ' ')}</span>
                            </div>
                          </div>
                          {att.summary && <p className="text-xs text-blue-800 mb-2">{att.summary}</p>}
                          {att.keyData?.length > 0 && (
                            <ul className="space-y-1">
                              {att.keyData.map((d, j) => (
                                <li key={j} className="text-xs text-blue-700 flex items-start gap-1.5">
                                  <span className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                                  {d}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Canales */}
                {campaign.channels?.length > 0 && (
                  <Section title="📡 Canales de pauta" color="purple">
                    <div className="flex flex-wrap gap-2">
                      {campaign.channels.map((c) => (
                        <span key={c} className="px-3 py-1.5 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">{c}</span>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Objetivos + KPIs */}
                <div className="grid grid-cols-2 gap-4">
                  {campaign.objectives?.length > 0 && (
                    <Section title="🎯 Objetivos" color="green">
                      <BulletList items={campaign.objectives} color="green" />
                    </Section>
                  )}
                  {campaign.kpis?.length > 0 && (
                    <Section title="📊 KPIs esperados" color="green">
                      <BulletList items={campaign.kpis} color="green" />
                    </Section>
                  )}
                </div>

                {/* Audience + tone */}
                <div className="grid grid-cols-2 gap-4">
                  {campaign.targetAudience && (
                    <Section title="👥 Público objetivo" color="indigo">
                      <p className="text-sm text-indigo-800">{campaign.targetAudience}</p>
                    </Section>
                  )}
                  {campaign.tone && (
                    <Section title="🗣 Tono de comunicación" color="indigo">
                      <p className="text-sm text-indigo-800">{campaign.tone}</p>
                    </Section>
                  )}
                </div>

                {/* RTBs */}
                {campaign.rtb?.length > 0 && (
                  <Section title="💡 Razones para creer (RTBs)" color="yellow">
                    <BulletList items={campaign.rtb} color="yellow" />
                  </Section>
                )}

                {/* Dos & Donts */}
                {(campaign.dos?.length > 0 || campaign.donts?.length > 0) && (
                  <div className="grid grid-cols-2 gap-4">
                    {campaign.dos?.length > 0 && (
                      <Section title="✅ Sí hacer" color="green">
                        <BulletList items={campaign.dos} color="green" />
                      </Section>
                    )}
                    {campaign.donts?.length > 0 && (
                      <Section title="❌ No hacer" color="red">
                        <BulletList items={campaign.donts} color="red" />
                      </Section>
                    )}
                  </div>
                )}

                {/* Investment phases */}
                {campaign.investmentPhases?.length > 0 && (
                  <Section title="🗓 Fases de inversión" color="orange">
                    <ol className="space-y-1.5">
                      {campaign.investmentPhases.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-orange-800">
                          <span className="w-5 h-5 rounded-full bg-orange-200 text-orange-800 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                          {f}
                        </li>
                      ))}
                    </ol>
                  </Section>
                )}

                {/* Learnings */}
                {campaign.learnings?.length > 0 && (
                  <Section title="📚 Aprendizajes previos" color="gray">
                    <BulletList items={campaign.learnings} color="gray" />
                  </Section>
                )}

                {/* Competition */}
                {campaign.competition && (
                  <Section title="🏁 Competencia" color="gray">
                    <p className="text-sm text-gray-700">{campaign.competition}</p>
                  </Section>
                )}

                {/* Resources */}
                {campaign.resources && (
                  <Section title="🗂 Recursos disponibles" color="gray">
                    <p className="text-sm text-gray-700">{campaign.resources}</p>
                  </Section>
                )}

                {/* Sales room */}
                {campaign.salesRoomAddress && (
                  <Section title="📍 Sala de ventas" color="gray">
                    <p className="text-sm text-gray-700">{campaign.salesRoomAddress}</p>
                  </Section>
                )}
              </>
            )}
          </div>
        )}

        {/* ── TRÁFICO ── */}
        {tab === 'traffic' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-800">Plan de tráfico</h2>
                <p className="text-xs text-gray-400 mt-0.5">{project.trafficEntries.length} tareas</p>
              </div>
              <Link href={`/dashboard/traffic?projectId=${project.id}`} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">Editar en panel completo →</Link>
            </div>

            {Object.keys(trafficByWeek).length === 0 ? (
              <div className="card p-12 text-center">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-gray-500">Sin tareas de tráfico aún</p>
                <p className="text-xs text-gray-400 mt-1">Usa la auto-asignación IA en el tab Resumen</p>
              </div>
            ) : Object.entries(trafficByWeek).map(([weekLabel, entries]) => {
              const ws = entries[0]?.weekStart
              const we = entries[0]?.weekEnd
              const exportUrl = ws && we
                ? `/api/traffic/export?projectId=${project.id}&weekLabel=${encodeURIComponent(weekLabel)}&weekStart=${ws.toISOString().slice(0,10)}&weekEnd=${we.toISOString().slice(0,10)}`
                : null
              return (
                <div key={weekLabel} className="card overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">{weekLabel}</span>
                      <span className="text-xs text-gray-400">{entries.length} tareas</span>
                      {entries.some((e) => e.aiGenerated) && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">🤖</span>}
                    </div>
                    {exportUrl && <a href={exportUrl} className="text-xs text-green-700 hover:text-green-800 font-medium">↓ Excel</a>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-gray-800 text-white">
                        <th className="px-3 py-2 text-left">Día</th>
                        <th className="px-3 py-2 text-left">Requerimiento</th>
                        <th className="px-3 py-2 text-center">#T</th>
                        <th className="px-3 py-2 text-center">Copy</th>
                        <th className="px-3 py-2 text-center">#G</th>
                        <th className="px-3 py-2 text-center">Gráfico</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {entries.map((e) => (
                          <tr key={e.id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 font-medium whitespace-nowrap">{e.dayOfWeek}</td>
                            <td className="px-3 py-1.5 text-gray-600 max-w-xs truncate">{e.requirement}</td>
                            <td className="px-3 py-1.5 text-center">{e.numTexts || ''}</td>
                            <td className="px-3 py-1.5 text-center">{e.copyName && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{e.copyName}</span>}</td>
                            <td className="px-3 py-1.5 text-center">{e.numGraphics || ''}</td>
                            <td className="px-3 py-1.5 text-center">{e.graphicName && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full">{e.graphicName}</span>}</td>
                            <td className="px-3 py-1.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[e.status] ?? 'bg-gray-100'}`}>{STATUS_LABELS[e.status] ?? e.status}</span></td>
                          </tr>
                        ))}
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
              <div className="card p-12 text-center">
                <p className="text-4xl mb-3">🎯</p>
                <p className="text-gray-500">Sin estructura Jira</p>
                <GenerateJiraButton projectId={project.id} />
              </div>
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

const SECTION_STYLES: Record<string, { bg: string; title: string; border: string }> = {
  blue:   { bg: 'bg-blue-50',   title: 'text-blue-800',   border: 'border-blue-100' },
  purple: { bg: 'bg-purple-50', title: 'text-purple-800', border: 'border-purple-100' },
  green:  { bg: 'bg-green-50',  title: 'text-green-800',  border: 'border-green-100' },
  red:    { bg: 'bg-red-50',    title: 'text-red-800',    border: 'border-red-100' },
  yellow: { bg: 'bg-yellow-50', title: 'text-yellow-800', border: 'border-yellow-100' },
  orange: { bg: 'bg-orange-50', title: 'text-orange-800', border: 'border-orange-100' },
  indigo: { bg: 'bg-indigo-50', title: 'text-indigo-800', border: 'border-indigo-100' },
  gray:   { bg: 'bg-gray-50',   title: 'text-gray-800',   border: 'border-gray-200' },
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  const s = SECTION_STYLES[color] ?? SECTION_STYLES.gray
  return (
    <div className={`rounded-xl border p-4 ${s.bg} ${s.border}`}>
      <h3 className={`text-sm font-semibold mb-3 ${s.title}`}>{title}</h3>
      {children}
    </div>
  )
}

const BULLET_COLORS: Record<string, string> = {
  green: 'text-green-700', red: 'text-red-700', yellow: 'text-yellow-700',
  gray: 'text-gray-600', indigo: 'text-indigo-700',
}
const BULLET_DOT: Record<string, string> = {
  green: 'bg-green-400', red: 'bg-red-400', yellow: 'bg-yellow-400',
  gray: 'bg-gray-400', indigo: 'bg-indigo-400',
}

function BulletList({ items, color }: { items: string[]; color: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className={`flex items-start gap-2 text-sm ${BULLET_COLORS[color] ?? 'text-gray-700'}`}>
          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${BULLET_DOT[color] ?? 'bg-gray-400'}`} />
          {item}
        </li>
      ))}
    </ul>
  )
}
