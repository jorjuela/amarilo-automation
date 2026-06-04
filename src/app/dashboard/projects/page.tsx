export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import NewProjectButton from '@/components/projects/NewProjectButton'
import ProjectsClient from '@/components/projects/ProjectsClient'

async function getProjects() {
  try {
    return await prisma.project.findMany({
      include: { torres: { select: { id: true, name: true, leadGoal: true, budget: true } } },
      orderBy: { createdAt: 'desc' },
    })
  } catch {
    return []
  }
}

export default async function ProjectsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const raw = await getProjects()

  // Serialize for the client component
  const projects = raw.map((p) => ({
    id: p.id,
    name: p.name,
    macroProject: p.macroProject,
    city: p.city,
    type: p.type,
    stage: p.stage,
    status: p.status,
    monthYear: p.monthYear,
    createdAt: p.createdAt.toISOString(),
    googleSheetUrl: p.googleSheetUrl,
    needsReview: (p as { needsReview?: boolean }).needsReview ?? false,
    parseSource: (p as { parseSource?: string }).parseSource ?? null,
    torres: p.torres,
  }))

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
          <p className="text-sm text-gray-500 mt-0.5">{projects.length} proyectos registrados</p>
        </div>
        <NewProjectButton />
      </div>

      <ProjectsClient projects={projects} />
    </div>
  )
}
