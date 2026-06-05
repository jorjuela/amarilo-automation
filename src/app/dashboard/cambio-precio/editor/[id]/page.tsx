export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import HtmlPieceEditor from '@/components/price/HtmlPieceEditor'

export default async function PieceEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const piece = await prisma.pricePiece.findUnique({
    where: { id },
    include: { project: { select: { name: true, city: true } } },
  })
  if (!piece) notFound()

  // Extract saved HTML from priceConfig if it was previously generated
  let savedHtml: string | null = null
  let width  = 540
  let height = 960
  try {
    const cfg = JSON.parse(piece.priceConfig || '{}')
    savedHtml = cfg.generatedHtml ?? null
    if (cfg.width)  width  = cfg.width
    if (cfg.height) height = cfg.height
  } catch { /* ignore */ }

  // Infer dimensions from format
  if (!savedHtml) {
    if (piece.format === '1x1')  { width = 600;  height = 600  }
    if (piece.format === '4x5')  { width = 480;  height = 600  }
    if (piece.format === '16x9') { width = 960;  height = 540  }
    if (piece.format === '4x3')  { width = 800;  height = 600  }
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <Link href="/dashboard/cambio-precio"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          ← Board
        </Link>
        <span className="text-gray-300">|</span>
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">{piece.name}</h1>
          <p className="text-xs text-gray-400">{piece.project.name} · {piece.project.city} · {piece.format}</p>
        </div>
        <div className="ml-2 flex gap-2">
          {piece.currentPrice && (
            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
              Precio actual: {piece.currentPrice}
            </span>
          )}
          {!piece.imageBase64 && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
              ⚠ Sin imagen — sube una desde el board
            </span>
          )}
        </div>
        <div className="ml-auto text-xs text-gray-400 space-x-3">
          <span>✨ Genera el HTML con IA</span>
          <span>·</span>
          <span>✏️ Edita el código o el preview</span>
          <span>·</span>
          <span>↓ Exporta PNG (Playwright)</span>
        </div>
      </div>

      {/* ── Editor (fills remaining height) ── */}
      <div className="flex-1 min-h-0">
        <HtmlPieceEditor
          pieceId={piece.id}
          pieceName={piece.name}
          projectName={piece.project.name}
          imageBase64={piece.imageBase64}
          initialHtml={savedHtml}
          width={width}
          height={height}
        />
      </div>
    </div>
  )
}
