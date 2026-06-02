export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { Stage } from '@/types'
import CreateSheetButton from '@/components/projects/CreateSheetButton'
import GenerateJiraButton from '@/components/projects/GenerateJiraButton'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  let project
  try {
    project = await prisma.project.findUnique({
      where: { id },
      include: { torres: true, jiraStructures: true },
    })
  } catch {
    notFound()
  }

  if (!project) notFound()

  const stage = project.stage as Stage
  const stageColors = {
    EXPECTATIVA: 'bg-pink-100 text-pink-700',
    LANZAMIENTO: 'bg-orange-100 text-orange-700',
    SOSTENIMIENTO: 'bg-yellow-100 text-yellow-700',
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${stageColors[stage]}`}>
              {stage}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
              {project.type}
            </span>
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

      {/* Email info */}
      {project.emailSubject && (
        <div className="card p-4 mb-6 border-l-4 border-blue-400">
          <p className="text-xs text-gray-500 font-medium">Email de origen</p>
          <p className="text-sm font-medium text-gray-800 mt-0.5">{project.emailSubject}</p>
          {project.emailReceivedAt && (
            <p className="text-xs text-gray-400 mt-0.5">Recibido: {formatDate(project.emailReceivedAt)}</p>
          )}
        </div>
      )}

      {/* Torres */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Torres / Sub-proyectos</h2>
        <div className="grid grid-cols-2 gap-4">
          {project.torres.map((torre) => {
            const areas: string[] = JSON.parse(torre.areas)
            return (
              <div key={torre.id} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800">{torre.name}</h3>
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">
                    NO VIS
                  </span>
                </div>
                <div className="space-y-2">
                  {areas.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Áreas:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {areas.map((a, i) => (
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
                    <div>
                      <span className="text-xs text-gray-400">Motivo compra:</span>
                      <span className="text-xs text-gray-700 ml-1">{torre.motivo}</span>
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
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">Google Sheet: Amarilo-cliente</p>
              <p className="text-xs text-gray-400 mt-0.5">Tabs: inventario-piezas · estatus-creatividad</p>
            </div>
            <a
              href={project.googleSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
            >
              Abrir en Google Sheets →
            </a>
          </div>
        </div>
      )}

      {/* Jira structures */}
      {project.jiraStructures.length > 0 && (
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Estructura Jira generada</h2>
          <div className="space-y-3">
            {(() => {
              const grouped: Record<string, typeof project.jiraStructures> = {}
              for (const s of project.jiraStructures) {
                if (!grouped[s.epic]) grouped[s.epic] = []
                grouped[s.epic].push(s)
              }
              return Object.entries(grouped).map(([epic, items]) => (
                <div key={epic} className="border border-purple-100 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-purple-600 text-white text-xs font-bold rounded">ÉPICA</span>
                    <span className="font-semibold text-purple-800">{epic}</span>
                  </div>
                  {items.slice(0, 3).map((item) => (
                    <div key={item.id} className="ml-4 mb-1">
                      <span className="px-2 py-0.5 bg-blue-500 text-white text-xs font-bold rounded">TAREA</span>
                      <span className="text-xs text-blue-800 ml-1">{item.task}</span>
                      <div className="ml-6 mt-0.5">
                        <span className="px-2 py-0.5 bg-green-400 text-white text-xs font-bold rounded">SUB</span>
                        <span className="text-xs text-green-800 ml-1">{item.subtask}</span>
                      </div>
                    </div>
                  ))}
                  {items.length > 3 && (
                    <p className="text-xs text-gray-400 ml-4">+{items.length - 3} subtareas más</p>
                  )}
                </div>
              ))
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
