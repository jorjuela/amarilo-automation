export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import TrafficPanel from '@/components/traffic/TrafficPanel'

async function getData() {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, city: true, stage: true, torres: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return { projects }
}

export default async function TrafficPage() {
  const { projects } = await getData()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tráfico Interno</h1>
        <p className="text-sm text-gray-500 mt-1">
          Planificación semanal del equipo creativo · Exporta el Excel de tráfico
        </p>
      </div>
      <TrafficPanel projects={projects} />
    </div>
  )
}
