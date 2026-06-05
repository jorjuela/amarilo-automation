export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import PriceBoardClient from '@/components/price/PriceBoardClient'

export default async function CambioPrecioPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [rawPieces, rawProjects] = await Promise.all([
    prisma.pricePiece.findMany({
      where: { active: true },
      include: { project: { select: { id: true, name: true, city: true, stage: true } } },
      orderBy: [{ projectId: 'asc' }, { format: 'asc' }],
    }),
    prisma.project.findMany({
      select: { id: true, name: true, city: true, stage: true },
      where: { status: { not: 'deleted' } },
      orderBy: { name: 'asc' },
    }),
  ])

  const pieces = rawPieces.map((p) => ({
    id: p.id,
    name: p.name,
    format: p.format,
    currentPrice: p.currentPrice,
    priceSMMLV: p.priceSMMLV,
    areas: p.areas,
    tagline: p.tagline,
    bgImageBase64: p.bgImageBase64,
    projectId: p.projectId,
    project: p.project,
  }))

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cambio de Precio</h1>
        <p className="text-sm text-gray-500 mt-1">
          Selecciona piezas publicitarias, ingresa el nuevo precio y descarga las imágenes generadas.
          Las piezas se agrupan por campaña/proyecto.
        </p>
      </div>

      {/* How it works */}
      <div className="card p-4 mb-6 bg-blue-50 border border-blue-100">
        <div className="flex items-start gap-3">
          <span className="text-2xl">💡</span>
          <div className="grid grid-cols-4 gap-4 flex-1">
            {[
              { step: '1', title: 'Agrega piezas', desc: 'Crea la pieza con imagen de fondo y datos del proyecto.' },
              { step: '2', title: 'Selecciona', desc: 'Marca las piezas que quieres actualizar en el board.' },
              { step: '3', title: 'Ingresa precio', desc: 'Escribe el nuevo precio y SMMLV en el panel azul.' },
              { step: '4', title: 'Descarga', desc: 'Las imágenes se generan como PNG con el precio actualizado.' },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{s.step}</span>
                <div><p className="text-xs font-semibold text-blue-800">{s.title}</p><p className="text-xs text-blue-600 mt-0.5">{s.desc}</p></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <PriceBoardClient initialPieces={pieces} projects={rawProjects} />
    </div>
  )
}
