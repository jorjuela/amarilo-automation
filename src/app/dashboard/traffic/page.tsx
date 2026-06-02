export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import TrafficPanel from '@/components/traffic/TrafficPanel'

export default async function TrafficPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  let projects: { id: string; name: string; city: string; stage: string; torres: { name: string }[] }[] = []
  try {
    projects = await prisma.project.findMany({
      select: { id: true, name: true, city: true, stage: true, torres: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
  } catch {
    // DB error — render panel with empty projects list
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tráfico Interno</h1>
        <p className="text-sm text-gray-500 mt-1">Planificación semanal del equipo creativo · Exporta el Excel de tráfico</p>
      </div>
      <TrafficPanel projects={projects} />
    </div>
  )
}
