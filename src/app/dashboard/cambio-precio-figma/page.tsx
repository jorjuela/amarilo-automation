export const dynamic = 'force-dynamic'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import FigmaEditorClient from './FigmaEditorClient'

export default async function CambioPrecioFigmaPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  // Check if Figma token is configured
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  const config = settings ? JSON.parse(settings.data) : {}
  const hasFigmaToken = Boolean(config.figma?.token)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cambio de Precio — Figma</h1>
        <p className="text-sm text-gray-500 mt-1">
          Conecta un archivo Figma, detecta precios con IA y actualiza todas las piezas en lote.
        </p>
      </div>

      {!hasFigmaToken && (
        <div className="card p-4 mb-6 bg-amber-50 border border-amber-200">
          <div className="flex items-start gap-3">
            <span className="text-amber-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">Token de Figma no configurado</p>
              <p className="text-xs text-amber-700 mt-1">
                Ve a{' '}
                <a href="/dashboard/settings" className="underline font-medium">Configuración → Figma</a>{' '}
                para agregar tu Personal Access Token de Figma antes de continuar.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="card p-4 mb-6 bg-blue-50 border border-blue-100">
        <div className="grid grid-cols-5 gap-3">
          {[
            { step: '1', title: 'Pega la URL de Figma', desc: 'Cualquier archivo al que tengas acceso.' },
            { step: '2', title: 'Carga los frames', desc: 'El sistema lista todos los artboards del archivo.' },
            { step: '3', title: 'Detecta precios con IA', desc: 'Gemini + Figma API identifican automáticamente dónde están los precios.' },
            { step: '4', title: 'Escribe el nuevo precio', desc: 'Un campo para cambiarlo en todas las piezas seleccionadas.' },
            { step: '5', title: 'Descarga PNG', desc: 'Exporta las piezas actualizadas con la misma tipografía.' },
          ].map((s) => (
            <div key={s.step} className="flex items-start gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {s.step}
              </span>
              <div>
                <p className="text-xs font-semibold text-blue-800">{s.title}</p>
                <p className="text-xs text-blue-600 mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <FigmaEditorClient hasFigmaToken={hasFigmaToken} />
    </div>
  )
}
