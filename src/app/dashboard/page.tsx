export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

async function getStats() {
  try {
    const [totalProjects, byStage, recentEmails] = await Promise.all([
      prisma.project.count(),
      prisma.project.groupBy({ by: ['stage'], _count: true }),
      prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    ])
    return { totalProjects, byStage, recentEmails, error: null }
  } catch {
    return { totalProjects: 0, byStage: [], recentEmails: [], error: 'Error al cargar datos' }
  }
}

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const { totalProjects, byStage, recentEmails, error } = await getStats()

  const stageCount = {
    EXPECTATIVA: byStage.find((s) => s.stage === 'EXPECTATIVA')?._count ?? 0,
    LANZAMIENTO: byStage.find((s) => s.stage === 'LANZAMIENTO')?._count ?? 0,
    SOSTENIMIENTO: byStage.find((s) => s.stage === 'SOSTENIMIENTO')?._count ?? 0,
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Bienvenido, <span className="font-medium text-gray-700">{session.name}</span>
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Proyectos" value={totalProjects} color="bg-blue-50 text-blue-700" />
        <StatCard label="Expectativa" value={stageCount.EXPECTATIVA} color="bg-pink-50 text-pink-700" sub="45 días" />
        <StatCard label="Lanzamiento" value={stageCount.LANZAMIENTO} color="bg-orange-50 text-orange-700" sub="3 meses" />
        <StatCard label="Sostenimiento" value={stageCount.SOSTENIMIENTO} color="bg-yellow-50 text-yellow-700" sub="+4 meses" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Acciones Rápidas</h2>
          <div className="space-y-3">
            <QuickAction href="/dashboard/projects" label="Ver proyectos" desc="Lista de todos los proyectos activos" icon="🏗" />
            <QuickAction href="/dashboard/traffic" label="Tráfico semanal" desc="Editar y exportar el tráfico interno" icon="📋" />
            <QuickAction href="/dashboard/jira" label="Generar Jira" desc="Copiar EPICAs, TAREAs y SUBTAREAs" icon="⚡" />
            {session.role === 'ADMIN' && (
              <QuickAction href="/dashboard/settings" label="Configurar credenciales" desc="Gmail, Google Drive, Jira" icon="⚙" />
            )}
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Actividad de Email</h2>
          {recentEmails.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <div className="text-3xl mb-2">📬</div>
              <p className="text-sm">No hay emails procesados aún</p>
              {session.role === 'ADMIN' && (
                <p className="text-xs mt-1">Configura Gmail en <Link href="/dashboard/settings" className="underline text-blue-400">Configuración</Link></p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {recentEmails.map((email) => (
                <div key={email.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${email.processed ? 'bg-green-500' : 'bg-yellow-400'}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{email.subject}</p>
                    <p className="text-xs text-gray-400">{formatDate(email.receivedAt)}</p>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${email.processed ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {email.processed ? 'OK' : 'Pendiente'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {session.role === 'ADMIN' && (
        <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-3">
          <span className="text-lg">🤖</span>
          <div>
            <p className="text-sm font-medium text-blue-800">Monitor de email automático</p>
            <p className="text-xs text-blue-600 mt-0.5">
              El cron job revisa tu Gmail cada 15 minutos buscando{' '}
              <code className="bg-blue-100 px-1 rounded">AMARILO | Proyecto | Ciudad</code>.
              Actívalo en <Link href="/dashboard/settings" className="underline">Configuración</Link>.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color.split(' ')[1]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function QuickAction({ href, label, desc, icon }: { href: string; label: string; desc: string; icon: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-sm font-medium text-gray-800 group-hover:text-blue-700">{label}</p>
        <p className="text-xs text-gray-400">{desc}</p>
      </div>
    </Link>
  )
}
