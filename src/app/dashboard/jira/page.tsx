export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import JiraGenerator from '@/components/jira/JiraGenerator'

async function getData() {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, city: true, stage: true, monthYear: true },
    orderBy: { createdAt: 'desc' },
  })
  return { projects }
}

export default async function JiraPage() {
  const { projects } = await getData()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Estructura Jira</h1>
        <p className="text-sm text-gray-500 mt-1">
          Genera y copia la estructura de Épicas, Tareas y Subtareas para crear en Jira
        </p>
        <div className="mt-2 p-2 bg-blue-50 rounded-lg border border-blue-100 inline-block">
          <p className="text-xs text-blue-700">
            Tablero Jira:{' '}
            <a
              href="https://brandigital.jira.com/jira/software/c/projects/AMARILO/boards/989/timeline"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
            >
              brandigital.jira.com → AMARILO → board 989
            </a>
          </p>
        </div>
      </div>
      <JiraGenerator projects={projects} />
    </div>
  )
}
