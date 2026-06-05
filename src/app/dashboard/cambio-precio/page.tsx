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
      orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
    }),
    prisma.project.findMany({
      select: { id: true, name: true, city: true, stage: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const pieces = rawPieces.map((p) => ({
    id: p.id,
    name: p.name,
    format: p.format,
    currentPrice: p.currentPrice,
    priceSMMLV: p.priceSMMLV,
    imageBase64: p.imageBase64,
    priceConfig: p.priceConfig,
    projectId: p.projectId,
    project: p.project,
  }))

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cambio de Precio</h1>
        <p className="text-sm text-gray-500 mt-1">
          Sube tus piezas publicitarias, posiciona el precio y actualízalo en lote.
        </p>
      </div>

      {/* How it works */}
      <div className="card p-4 mb-6 bg-blue-50 border border-blue-100">
        <div className="grid grid-cols-4 gap-4">
          {[
            { step: '1', title: 'Sube la pieza',     desc: 'Sube tu imagen JPG/PNG (el diseño completo).' },
            { step: '2', title: 'Posiciona el precio', desc: 'Haz clic en la imagen para marcar dónde va el precio.' },
            { step: '3', title: 'Selecciona en el board', desc: 'Marca las piezas que quieres actualizar.' },
            { step: '4', title: 'Cambia y descarga', desc: 'Escribe el nuevo precio y descarga los PNG.' },
          ].map((s) => (
            <div key={s.step} className="flex items-start gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{s.step}</span>
              <div><p className="text-xs font-semibold text-blue-800">{s.title}</p><p className="text-xs text-blue-600 mt-0.5">{s.desc}</p></div>
            </div>
          ))}
        </div>
      </div>

      <PriceBoardClient initialPieces={pieces} projects={rawProjects} />
    </div>
  )
}
