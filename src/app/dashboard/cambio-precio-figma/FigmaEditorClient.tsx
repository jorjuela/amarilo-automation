'use client'

import { useState, useEffect } from 'react'
import type { DetectedFrame } from '@/lib/figma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceElement {
  id: string
  text: string
  top: number        // % from top of frame (0-100)
  left: number       // % from left of frame (0-100)
  widthPct: number   // % width of frame
  heightPct: number  // % height of frame
  fontSize: number   // px, from Figma
  fontWeight: number
  fontFamily: string
  color: string      // CSS rgba
}

// DetectedFrame enriched by the hybrid MCP+REST endpoint
interface EnrichedFrame extends DetectedFrame {
  mcpPriceHints?: string[]      // price text strings found by Figma MCP
  mcpHasPriceHints?: boolean
}

interface FrameItem {
  frame: EnrichedFrame
  thumbnail: string | null      // low-res preview (scale 0.3) loaded on file open
  imageBase64: string | null    // high-res (scale 2) loaded on "Procesar"
  newBackground: string | null  // user-uploaded replacement for background layer
  priceElements: PriceElement[]
  status: 'idle' | 'exporting' | 'detecting' | 'ready' | 'rendering' | 'done' | 'error'
  error?: string
  newPrice: string
  exportedPng?: string
  selected: boolean
}

// ─── Main component ───────────────────────────────────────────────────────────

const LS_KEY = 'figma_last_url'

export default function FigmaEditorClient({ hasFigmaToken }: { hasFigmaToken: boolean }) {
  const [fileUrl, setFileUrl] = useState('')
  const [fileKey, setFileKey] = useState('')
  const [fileName, setFileName] = useState('')
  const [mcpAvailable, setMcpAvailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [frames, setFrames] = useState<FrameItem[]>([])
  const [globalPrice, setGlobalPrice] = useState('')
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  // Restore last used URL from localStorage or ?url= query param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const queryUrl = params.get('url') || params.get('fileUrl')
    if (queryUrl) {
      setFileUrl(queryUrl)
      return
    }
    const saved = localStorage.getItem(LS_KEY)
    if (saved) setFileUrl(saved)
  }, [])

  const activeFrame = frames.find((f) => f.frame.id === activeFrameId) || null

  // ── Load Figma file (hybrid: MCP enriched + REST coordinates) ────────────

  async function handleLoadFile() {
    if (!fileUrl.trim()) return
    setLoading(true)
    setLoadError('')
    setFrames([])
    setActiveFrameId(null)
    setMcpAvailable(false)

    // Persist URL so it's available next visit
    localStorage.setItem(LS_KEY, fileUrl.trim())

    try {
      const res = await fetch(`/api/figma?fileUrl=${encodeURIComponent(fileUrl)}`)
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error || 'Error cargando el archivo'); return }

      setFileKey(data.fileKey)
      setFileName(data.fileName)
      setMcpAvailable(!!data.mcpAvailable)

      const items: FrameItem[] = (data.frames as EnrichedFrame[]).map((f) => ({
        frame: f,
        thumbnail: null,
        imageBase64: null,
        newBackground: null,
        priceElements: [],
        status: 'idle',
        newPrice: '',
        selected: f.priceNodes.length > 0 || (f.mcpHasPriceHints ?? false),
      }))
      setFrames(items)

      const first = items.find((i) => i.frame.priceNodes.length > 0 || i.frame.mcpHasPriceHints)
      if (first) setActiveFrameId(first.frame.id)

      // Load thumbnails in background — doesn't block the UI
      loadThumbnails(data.fileKey, items)
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }

  // ── Thumbnail loader (low-res, batched, non-blocking) ────────────────────
  // Batches of 10 frames at scale=0.3 so the list shows previews progressively.

  async function loadThumbnails(key: string, items: FrameItem[]) {
    const BATCH = 10
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      try {
        const res = await fetch('/api/figma', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileKey: key, frameIds: batch.map((b) => b.frame.id), scale: 0.3 }),
        })
        if (!res.ok) break
        const data = await res.json() as { images: Record<string, string> }
        setFrames((prev) =>
          prev.map((f) =>
            data.images[f.frame.id] ? { ...f, thumbnail: data.images[f.frame.id] } : f
          )
        )
      } catch {
        break // thumbnails are optional — silently ignore errors
      }
    }
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  function toggleSelect(frameId: string) {
    setFrames((prev) => prev.map((f) => f.frame.id === frameId ? { ...f, selected: !f.selected } : f))
  }
  function selectAll() {
    setFrames((prev) => prev.map((f) => ({ ...f, selected: true })))
  }
  function selectWithPrices() {
    setFrames((prev) => prev.map((f) => ({
      ...f,
      selected: f.frame.priceNodes.length > 0 || (f.frame.mcpHasPriceHints ?? false),
    })))
  }

  // ── Export + detect for selected frames ──────────────────────────────────

  async function handleProcessSelected() {
    const selected = frames.filter((f) => f.selected)
    if (selected.length === 0) return
    setProcessing(true)

    const frameIds = selected.map((f) => f.frame.id)
    setFrames((prev) =>
      prev.map((f) => selected.some((s) => s.frame.id === f.frame.id) ? { ...f, status: 'exporting' } : f)
    )

    // 1. Export frames from Figma CDN → base64
    let imageMap: Record<string, string> = {}
    try {
      const res = await fetch('/api/figma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey, frameIds, scale: 2 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error exportando frames')
      imageMap = data.images
    } catch (err) {
      setFrames((prev) =>
        prev.map((f) => selected.some((s) => s.frame.id === f.frame.id)
          ? { ...f, status: 'error', error: String(err) } : f)
      )
      setProcessing(false)
      return
    }

    // 2. Run price detection on each frame
    await Promise.all(
      selected.map(async (item) => {
        const img = imageMap[item.frame.id]
        if (!img) {
          setFrames((prev) =>
            prev.map((f) => f.frame.id === item.frame.id
              ? { ...f, status: 'error', error: 'No se pudo exportar el frame' } : f)
          )
          return
        }

        setFrames((prev) =>
          prev.map((f) => f.frame.id === item.frame.id ? { ...f, imageBase64: img, status: 'detecting' } : f)
        )

        try {
          const detectRes = await fetch('/api/figma/detect-price', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: img,
              // Pass full frame bounds so detect-price can subtract the frame origin
              frameBounds: item.frame.bounds,
              knownPriceNodes: item.frame.priceNodes,
            }),
          })
          const detectData = await detectRes.json()
          const priceElements: PriceElement[] = detectData.priceElements || []

          setFrames((prev) =>
            prev.map((f) => f.frame.id === item.frame.id ? { ...f, priceElements, status: 'ready' } : f)
          )
        } catch (detectErr) {
          setFrames((prev) =>
            prev.map((f) => f.frame.id === item.frame.id
              ? { ...f, status: 'error', error: String(detectErr) } : f)
          )
        }
      })
    )

    setProcessing(false)
    // Auto-open first processed frame
    const firstId = selected[0]?.frame.id
    if (firstId && !activeFrameId) setActiveFrameId(firstId)
  }

  // ── Apply global price ────────────────────────────────────────────────────

  function applyGlobalPrice() {
    if (!globalPrice.trim()) return
    setFrames((prev) =>
      prev.map((f) =>
        f.selected && (f.status === 'ready' || f.status === 'done')
          ? { ...f, newPrice: globalPrice }
          : f
      )
    )
  }

  // ── Render one frame with new price ──────────────────────────────────────

  async function renderFrame(frameId: string) {
    const item = frames.find((f) => f.frame.id === frameId)
    if (!item?.imageBase64 || !item.newPrice.trim() || item.priceElements.length === 0) return

    setFrames((prev) => prev.map((f) => f.frame.id === frameId ? { ...f, status: 'rendering' } : f))

    try {
      const { width, height } = item.frame.bounds
      // Use user-uploaded background if available, otherwise use the full frame export
      const bgImage = item.newBackground || item.imageBase64
      const html = buildPriceHtml(bgImage, item.priceElements, item.newPrice, width, height, !!item.newBackground)

      const exportRes = await fetch('/api/price-pieces/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, width, height, format: 'png' }),
      })

      if (!exportRes.ok) {
        const errData = await exportRes.json().catch(() => ({ error: 'Export failed' }))
        throw new Error(errData.error || 'Export failed')
      }

      const blob = await exportRes.blob()
      const pngUrl = URL.createObjectURL(blob)

      setFrames((prev) =>
        prev.map((f) => f.frame.id === frameId ? { ...f, status: 'done', exportedPng: pngUrl } : f)
      )
    } catch (err) {
      setFrames((prev) =>
        prev.map((f) => f.frame.id === frameId ? { ...f, status: 'error', error: String(err) } : f)
      )
    }
  }

  // ── Batch render ──────────────────────────────────────────────────────────

  async function renderAllSelected() {
    const toRender = frames.filter(
      (f) => f.selected && f.status === 'ready' && f.newPrice.trim() && f.priceElements.length > 0
    )
    for (const f of toRender) await renderFrame(f.frame.id)
  }

  // ── Download ZIP ──────────────────────────────────────────────────────────

  async function downloadAll() {
    const done = frames.filter((f) => f.status === 'done' && f.exportedPng)
    if (done.length === 0) return

    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    await Promise.all(
      done.map(async (item) => {
        const res = await fetch(item.exportedPng!)
        const blob = await res.blob()
        const safeName = item.frame.name.replace(/[^a-zA-Z0-9_\-]/g, '_')
        zip.file(`${safeName}_nuevo_precio.png`, blob)
      })
    )

    const content = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(content)
    a.download = `figma_precios_${Date.now()}.zip`
    a.click()
  }

  // ── Derived counts ────────────────────────────────────────────────────────

  const selectedCount = frames.filter((f) => f.selected).length
  const readyCount    = frames.filter((f) => f.status === 'ready').length
  const doneCount     = frames.filter((f) => f.status === 'done').length

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* File URL input */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-700">URL del archivo Figma</label>
          <span className="text-[10px] text-gray-400">
            Copia la URL desde Figma — funciona con /file/ y /design/
          </span>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadFile()}
              placeholder="https://www.figma.com/design/XXXXX/nombre-proyecto?node-id=..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 pr-7"
              disabled={!hasFigmaToken}
            />
            {fileUrl && (
              <button
                onClick={() => { setFileUrl(''); localStorage.removeItem(LS_KEY); setFrames([]); setFileName('') }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-base leading-none"
                title="Limpiar"
              >×</button>
            )}
          </div>
          <button
            onClick={handleLoadFile}
            disabled={loading || !fileUrl.trim() || !hasFigmaToken}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? 'Cargando...' : 'Cargar Archivo'}
          </button>
        </div>
        {loadError && <p className="text-red-600 text-xs mt-2">{loadError}</p>}
        {fileName && (
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <p className="text-green-700 text-xs font-medium">
              ✓ {fileName} — {frames.length} frames
              {frames.filter((f) => f.frame.priceNodes.length > 0 || f.frame.mcpHasPriceHints).length > 0 && (
                <span className="ml-1 text-amber-600">
                  ({frames.filter((f) => f.frame.priceNodes.length > 0 || f.frame.mcpHasPriceHints).length} con precios)
                </span>
              )}
            </p>
            {mcpAvailable ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">
                Figma MCP activo
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                solo REST
              </span>
            )}
          </div>
        )}
      </div>

      {frames.length > 0 && (
        <div className="flex gap-4">
          {/* Left panel: frame list */}
          <div className="w-72 flex-shrink-0 space-y-2">
            <div className="card p-3">
              <div className="flex gap-2 mb-3">
                <button onClick={selectAll} className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">
                  Todos
                </button>
                <button onClick={selectWithPrices} className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">
                  Con precios
                </button>
                <span className="ml-auto text-xs text-gray-500">{selectedCount} selec.</span>
              </div>
              <button
                onClick={handleProcessSelected}
                disabled={processing || selectedCount === 0}
                className="w-full py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                {processing ? 'Procesando...' : `Procesar ${selectedCount} frames`}
              </button>
            </div>

            <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
              {frames.map((item) => (
                <FrameCard
                  key={item.frame.id}
                  item={item}
                  isActive={activeFrameId === item.frame.id}
                  onSelect={() => toggleSelect(item.frame.id)}
                  onClick={() => setActiveFrameId(item.frame.id)}
                />
              ))}
            </div>
          </div>

          {/* Right panel: detail */}
          <div className="flex-1 space-y-3">
            {readyCount > 0 && (
              <div className="card p-4 flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Nuevo precio — aplicar a todos los frames seleccionados
                  </label>
                  <input
                    type="text"
                    value={globalPrice}
                    onChange={(e) => setGlobalPrice(e.target.value)}
                    placeholder="Ej: $520.000.000"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <button
                  onClick={applyGlobalPrice}
                  disabled={!globalPrice.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  Aplicar a todos
                </button>
                <button
                  onClick={renderAllSelected}
                  disabled={frames.filter((f) => f.selected && f.status === 'ready' && f.newPrice.trim()).length === 0}
                  className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90"
                  style={{ background: 'var(--amarilo-navy)' }}
                >
                  Generar todos
                </button>
                {doneCount > 0 && (
                  <button
                    onClick={downloadAll}
                    className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90"
                    style={{ background: 'var(--amarilo-yellow)', color: '#1B3D6B' }}
                  >
                    Descargar ZIP ({doneCount})
                  </button>
                )}
              </div>
            )}

            {activeFrame ? (
              <FrameDetail
                item={activeFrame}
                onPriceChange={(price) =>
                  setFrames((prev) =>
                    prev.map((f) => f.frame.id === activeFrame.frame.id ? { ...f, newPrice: price } : f)
                  )
                }
                onRender={() => renderFrame(activeFrame.frame.id)}
                onBackgroundChange={(bg) =>
                  setFrames((prev) =>
                    prev.map((f) => f.frame.id === activeFrame.frame.id ? { ...f, newBackground: bg } : f)
                  )
                }
              />
            ) : (
              <div className="card p-8 text-center text-gray-400 text-sm">
                Selecciona un frame de la lista para ver sus detalles
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FrameCard ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  idle: 'bg-gray-100 text-gray-500',
  exporting: 'bg-blue-100 text-blue-600',
  detecting: 'bg-purple-100 text-purple-600',
  ready: 'bg-green-100 text-green-700',
  rendering: 'bg-yellow-100 text-yellow-700',
  done: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-600',
}
const STATUS_LABEL: Record<string, string> = {
  idle: 'Pendiente', exporting: 'Exportando...', detecting: 'Detectando...',
  ready: 'Listo', rendering: 'Generando...', done: 'Generado', error: 'Error',
}

function FrameCard({
  item, isActive, onSelect, onClick,
}: {
  item: FrameItem; isActive: boolean; onSelect: () => void; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`card overflow-hidden cursor-pointer transition-all ${isActive ? 'ring-2 ring-blue-400' : 'hover:ring-1 hover:ring-gray-200'}`}
    >
      {/* Thumbnail strip */}
      <div className="relative w-full h-24 bg-gray-100 overflow-hidden">
        {item.exportedPng ? (
          <img src={item.exportedPng} alt="" className="w-full h-full object-cover" />
        ) : item.thumbnail ? (
          <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[10px] text-gray-300 animate-pulse">cargando...</span>
          </div>
        )}
        {/* Overlay badges */}
        <div className="absolute top-1 left-1 flex gap-1 flex-wrap">
          {item.frame.priceNodes.length > 0 && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/90 text-white font-bold">
              {item.frame.priceNodes.length} precio{item.frame.priceNodes.length !== 1 ? 's' : ''}
            </span>
          )}
          {item.frame.mcpHasPriceHints && item.frame.priceNodes.length === 0 && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/90 text-white font-bold">MCP</span>
          )}
        </div>
        {item.status === 'done' && (
          <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
            <span className="text-emerald-600 text-2xl font-bold">✓</span>
          </div>
        )}
        {(item.status === 'exporting' || item.status === 'detecting' || item.status === 'rendering') && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
          </div>
        )}
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={item.selected}
          onChange={(e) => { e.stopPropagation(); onSelect() }}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 rounded"
        />
      </div>

      {/* Name + status */}
      <div className="px-2 py-1.5">
        <p className="text-xs font-semibold text-gray-800 truncate leading-tight">{item.frame.name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${STATUS_COLOR[item.status]}`}>
            {STATUS_LABEL[item.status]}
          </span>
          <span className="text-[9px] text-gray-400 truncate">{item.frame.pageName}</span>
        </div>
      </div>
    </div>
  )
}

// ─── FrameDetail ──────────────────────────────────────────────────────────────

function FrameDetail({
  item, onPriceChange, onRender, onBackgroundChange,
}: {
  item: FrameItem
  onPriceChange: (p: string) => void
  onRender: () => void
  onBackgroundChange: (b: string | null) => void
}) {
  const isProcessing = item.status === 'exporting' || item.status === 'detecting' || item.status === 'rendering'

  function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onBackgroundChange(reader.result as string)
    reader.readAsDataURL(file)
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <span className="font-semibold text-gray-800 text-sm">{item.frame.name}</span>
          <span className="text-gray-400 text-xs ml-2">{item.frame.pageName}</span>
          {item.newBackground && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-medium">
              Fondo reemplazado
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400 font-mono">
          {Math.round(item.frame.bounds.width)} × {Math.round(item.frame.bounds.height)} px
        </span>
      </div>

      <div className="p-4 flex gap-4">
        {/* Preview */}
        <div className="flex-shrink-0">
          {item.status === 'done' && item.exportedPng ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-emerald-700">Resultado:</p>
              <img
                src={item.exportedPng}
                alt={item.frame.name}
                className="max-w-[220px] max-h-[300px] object-contain rounded border border-gray-200 shadow-sm"
              />
              <a
                href={item.exportedPng}
                download={`${item.frame.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}_nuevo_precio.png`}
                className="block text-center text-xs text-blue-600 hover:underline"
              >
                Descargar PNG
              </a>
            </div>
          ) : item.imageBase64 ? (
            <div className="relative">
              <img
                src={item.newBackground || item.imageBase64}
                alt={item.frame.name}
                className="max-w-[220px] max-h-[300px] object-contain rounded border border-gray-200"
              />
              {/* Price highlight overlays — always based on original imageBase64 positions */}
              {!item.newBackground && item.priceElements.map((el) => (
                <div
                  key={el.id}
                  className="absolute border-2 border-yellow-400 bg-yellow-400/20 rounded pointer-events-none"
                  style={{
                    top: `${el.top}%`,
                    left: `${el.left}%`,
                    width: `${el.widthPct}%`,
                    height: `${el.heightPct}%`,
                    minHeight: 12,
                  }}
                  title={`Precio: ${el.text}`}
                />
              ))}
            </div>
          ) : (
            <div
              className="w-[180px] h-[220px] bg-gray-100 rounded flex flex-col items-center justify-center overflow-hidden relative"
            >
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : isProcessing ? (
                <span className="text-xs text-gray-400 animate-pulse">
                  {item.status === 'exporting' ? 'Exportando...' : 'Analizando...'}
                </span>
              ) : (
                <span className="text-xs text-gray-400">Preview</span>
              )}
              {isProcessing && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-4">
          {/* Background replacement */}
          {(item.frame.backgroundNode || item.imageBase64) && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                Imagen de fondo
                {item.frame.backgroundNode && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-medium">
                    layer: {item.frame.backgroundNode.name}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer">
                  <div className={`border border-dashed rounded-lg px-3 py-2 text-xs text-center transition-colors ${item.newBackground ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}>
                    {item.newBackground ? '✓ Nueva imagen cargada' : 'Subir imagen de reemplazo…'}
                  </div>
                  <input type="file" accept="image/*" onChange={handleBgUpload} className="sr-only" />
                </label>
                {item.newBackground && (
                  <button
                    onClick={() => onBackgroundChange(null)}
                    className="text-xs px-2 py-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                    title="Quitar imagen"
                  >
                    Quitar
                  </button>
                )}
              </div>
              {item.newBackground && (
                <p className="text-[11px] text-gray-400 mt-1">
                  El resultado final usará esta imagen como fondo, con el precio superpuesto en la misma posición.
                </p>
              )}
            </div>
          )}

          {/* Detected prices */}
          {item.priceElements.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">
                Precios detectados ({item.priceElements.length}):
              </p>
              <div className="space-y-1">
                {item.priceElements.map((el) => (
                  <div key={el.id} className="flex items-center gap-2 text-xs bg-amber-50 rounded px-2 py-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                    <span className="font-mono font-semibold text-gray-800">{el.text}</span>
                    <span className="text-gray-400 text-[10px]">
                      {el.fontFamily} {el.fontSize}px {el.fontWeight >= 700 ? 'Bold' : ''}
                    </span>
                    <span
                      className="ml-auto w-3 h-3 rounded border border-gray-300 flex-shrink-0"
                      style={{ background: el.color }}
                      title={el.color}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.priceElements.length === 0 && item.status === 'ready' && (
            <div className="p-3 bg-amber-50 rounded border border-amber-100">
              <p className="text-xs text-amber-700">
                No se detectaron precios en este frame. El precio puede estar dentro de un objeto vectorial o imagen rasterizada.
              </p>
            </div>
          )}

          {/* New price input */}
          {(item.status === 'ready' || item.status === 'done' || item.status === 'rendering') && item.priceElements.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Nuevo precio</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={item.newPrice}
                  onChange={(e) => onPriceChange(e.target.value)}
                  placeholder="Ej: $520.000.000"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
                <button
                  onClick={onRender}
                  disabled={!item.newPrice.trim() || item.status === 'rendering'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {item.status === 'rendering' ? 'Generando...' : 'Generar'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Tipografía: {item.priceElements[0]?.fontFamily}, {item.priceElements[0]?.fontSize}px
              </p>
            </div>
          )}

          {item.status === 'error' && item.error && (
            <div className="p-3 bg-red-50 rounded border border-red-100">
              <p className="text-xs font-semibold text-red-700 mb-1">Error</p>
              <p className="text-xs text-red-600">{item.error}</p>
            </div>
          )}

          {isProcessing && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin flex-shrink-0" />
              {item.status === 'exporting' && 'Exportando frame desde Figma...'}
              {item.status === 'detecting' && 'Detectando precios con Gemini Vision...'}
              {item.status === 'rendering' && 'Generando PNG con nuevo precio...'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── HTML builder for Playwright rendering ────────────────────────────────────
// Uses top/left as percentages (already frame-relative from detect-price route).
// Font size in px directly (no vh) so it's independent of viewport quirks.

function buildPriceHtml(
  backgroundBase64: string,
  priceElements: PriceElement[],
  newPrice: string,
  width: number,
  height: number,
  _isReplacedBackground = false,
): string {
  const overlays = priceElements.map((el) => `<div style="
    position: absolute;
    top: ${el.top.toFixed(3)}%;
    left: ${el.left.toFixed(3)}%;
    width: ${el.widthPct.toFixed(3)}%;
    min-width: max-content;
    font-family: '${el.fontFamily}', 'Helvetica Neue', Arial, sans-serif;
    font-size: ${el.fontSize}px;
    font-weight: ${el.fontWeight};
    color: ${el.color};
    white-space: nowrap;
    line-height: 1.15;
    text-rendering: geometricPrecision;
    -webkit-font-smoothing: antialiased;
  ">${escHtml(newPrice)}</div>`).join('\n')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; }
  .frame { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
  <div class="frame">
    <img class="bg" src="${backgroundBase64}" />
    ${overlays}
  </div>
</body>
</html>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
