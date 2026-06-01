export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { Stage } from '@/types'
import { STAGE_LABELS } from '@/types'
import NewProjectButton from '@/components/projects/NewProjectButton'

async function getProjects() {
  return prisma.project.findMany({
    include: { torres: true },
    orderBy: { createdAt: 'desc' },
  })
}

const stageStyles: Record<Stage, { bg: string; text: string; dot: string }> = {
  EXPECTATIVA: { bg: 'bg-pink-50', text: 'text-pink-700', dot: 'bg-pink-500' },
  LANZAMIENTO: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  SOSTENIMIENTO: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
}

export default async function ProjectsPage() {
  const projects = await getProjects()

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
          <p className="text-sm text-gray-500 mt-1">{projects.length} proyectos registrados</p>
        </div>
        <NewProjectButton />
      </div>

      {/* Stage filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['EXPECTATIVA', 'LANZAMIENTO', 'SOSTENIMIENTO'] as Stage[]).map((stage) => {
          const count = projects.filter((p) => p.stage === stage).length
          const s = stageStyles[stage]
          return (
            <div key={stage} className={`px-4 py-2 rounded-full text-sm font-medium ${s.bg} ${s.text} flex items-center gap-2`}>
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              {stage.charAt(0) + stage.slice(1).toLowerCase()} ({count})
            </div>
          )
        })}
      </div>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => {
            const style = stageStyles[project.stage as Stage]
            const totalBudget = project.torres.reduce((sum, t) => sum + t.budget, 0)
            const totalLeads = project.torres.reduce((sum, t) => sum + t.leadGoal, 0)

            return (
              <Link
                key={project.id}
                href={`/dashboard/projects/${project.id}`}
                className="card p-5 hover:shadow-md transition-shadow block"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                      style={{ background: 'var(--amarilo-navy)' }}
                    >
                      {project.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{project.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
                          {project.type}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {project.city} · {project.monthYear || 'Sin fecha'}
                      </p>
                      <div className="flex items-center gap-4 mt-2">
                        {project.torres.slice(0, 4).map((t) => (
                          <span key={t.id} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">
                            {t.name}
                          </span>
                        ))}
                        {project.torres.length > 4 && (
                          <span className="text-xs text-gray-400">+{project.torres.length - 4} más</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-6 text-right">
                    <div>
                      <p className="text-xs text-gray-400">Leads/mes</p>
                      <p className="text-sm font-semibold text-gray-800">{totalLeads.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Presupuesto</p>
                      <p className="text-sm font-semibold text-gray-800">{formatCurrency(totalBudget)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Etapa</p>
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${style.bg} mt-0.5`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        <span className={`text-xs font-semibold ${style.text}`}>
                          {project.stage.charAt(0) + project.stage.slice(1).toLowerCase()}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Registrado</p>
                      <p className="text-xs text-gray-600">{formatDate(project.createdAt)}</p>
                    </div>
                  </div>
                </div>

                {/* Google Sheet link */}
                {project.googleSheetUrl && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                    <span className="text-xs text-green-600">✓ Google Sheet creado</span>
                    <a
                      href={project.googleSheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Abrir →
                    </a>
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="card p-16 text-center">
      <div className="text-5xl mb-4">🏗</div>
      <h3 className="text-lg font-semibold text-gray-700">No hay proyectos aún</h3>
      <p className="text-sm text-gray-400 mt-2 max-w-sm mx-auto">
        Los proyectos se crean automáticamente cuando llega un email con un brief,
        o puedes crear uno manualmente.
      </p>
      <div className="mt-4 p-3 bg-blue-50 rounded-lg text-left max-w-sm mx-auto">
        <p className="text-xs text-blue-700 font-medium">Patrón de email esperado:</p>
        <code className="text-xs text-blue-600">AMARILO | [Proyecto] | [Ciudad]</code>
      </div>
    </div>
  )
}
