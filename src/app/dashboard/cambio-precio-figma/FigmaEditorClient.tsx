'use client'

import { useState, useRef, useCallback } from 'react'
import type { DetectedFrame, PriceNode } from '@/lib/figma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceElement {
  id: string
  text: string
  top: number
  left: number
  fontSize: number
  fontWeight: number
  fontFamily: string
  color: string
  bounds: { x: number; y: number; width: number; height: number }
}

interface FrameItem {
  frame: DetectedFrame
  imageBase64: string | null   // null = not yet exported
  priceElements: PriceElement[]
  status: 'idle' | 'exporting' | 'detecting' | 'ready' | 'rendering' | 'done' | 'error'
  error?: string
  newPrice: string
  exportedPng?: string         // final rendered PNG with new price
  selected: boolean
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FigmaEditorClient({ hasFigmaToken }: { hasFigmaToken: boolean }) {
  const [fileUrl, setFileUrl] = useState('')
  const [fileKey, setFileKey] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [frames, setFrames] = useState<FrameItem[]>([])
  const [globalPrice, setGlobalPrice] = useState('')
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  const activeFrame = frames.find((f) => f.frame.id === activeFrameId) || null

  // ── Load Figma file frames ────────────────────────────────────────────────

  async function handleLoadFile() {
    if (!fileUrl.trim()) return
    setLoading(true)
    setLoadError('')
    setFrames([])
    setActiveFrameId(null)

    try {
      const res = await fetch(`/api/figma?fileUrl=${encodeURIComponent(fileUrl)}`)
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error || 'Error cargando el archivo'); return }

      setFileKey(data.fileKey)
      setFileName(data.fileName)
      const items: FrameItem[] = (data.frames as DetectedFrame[]).map((f) => ({
        frame: f,
        imageBase64: null,
        priceElements: f.priceNodes.map((n: PriceNode) => ({
          id: n.id,
          text: n.text,
          top: 0,   // will be filled during detect
          left: 0,
          fontSize: n.style.fontSize,
          fontWeight: n.style.fontWeight,
          fontFamily: n.style.fontFamily || 'Inter',
          color: '#FFFFFF',
          bounds: n.bounds,
        })),
        status: 'idle',
        newPrice: '',
        selected: f.priceNodes.length > 0, // auto-select frames with detected prices
      }))
      setFrames(items)
      // Auto-select first frame with prices
      const first = items.find((i) => i.frame.priceNodes.length > 0)
      if (first) setActiveFrameId(first.frame.id)
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }

  // ── Toggle frame selection ────────────────────────────────────────────────

  function toggleSelect(frameId: string) {
    setFrames((prev) =>
      prev.map((f) => f.frame.id === frameId ? { ...f, selected: !f.selected } : f)
    )
  }

  function selectAll() {
    setFrames((prev) => prev.map((f) => ({ ...f, selected: true })))
  }

  function selectWithPrices() {
    setFrames((prev) => prev.map((f) => ({ ...f, selected: f.frame.priceNodes.length > 0 })))
  }

  // ── Export + detect for selected frames ──────────────────────────────────

  async function handleProcessSelected() {
    const selected = frames.filter((f) => f.selected)
    if (selected.length === 0) return
    setProcessing(true)

    // 1. Export all selected frames as images
    const frameIds = selected.map((f) => f.frame.id)
    setFrames((prev) =>
      prev.map((f) => selected.some((s) => s.frame.id === f.frame.id)
        ? { ...f, status: 'exporting' } : f)
    )

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

    // 2. Run price detection on each frame concurrently
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
          prev.map((f) => f.frame.id === item.frame.id
            ? { ...f, imageBase64: img, status: 'detecting' } : f)
        )

        try {
          const detectRes = await fetch('/api/figma/detect-price', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: img,
              frameWidth: item.frame.bounds.width,
              frameHeight: item.frame.bounds.height,
              knownPriceNodes: item.frame.priceNodes,
            }),
          })
          const detectData = await detectRes.json()
          const priceElements: PriceElement[] = detectData.priceElements || []

          setFrames((prev) =>
            prev.map((f) => f.frame.id === item.frame.id
              ? { ...f, priceElements, status: 'ready' } : f)
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
    // Open first ready frame
    const first = frames.find((f) => selected.some((s) => s.frame.id === f.frame.id))
    if (first && !activeFrameId) setActiveFrameId(first.frame.id)
  }

  // ── Apply global price to all selected + ready frames ────────────────────

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

  // ── Render a single frame with new price via our existing to-html pipeline ─

  async function renderFrame(frameId: string) {
    const item = frames.find((f) => f.frame.id === frameId)
    if (!item?.imageBase64 || !item.newPrice.trim() || item.priceElements.length === 0) return

    setFrames((prev) =>
      prev.map((f) => f.frame.id === frameId ? { ...f, status: 'rendering' } : f)
    )

    try {
      // Build HTML overlay: background image + text elements with detected positions
      const { width, height } = item.frame.bounds
      const priceEl = item.priceElements[0] // use first price element as primary

      // Build a simple HTML with the new price at the detected position
      const html = buildPriceHtml(item.imageBase64, item.priceElements, item.newPrice, width, height)

      // Export via Playwright
      const exportRes = await fetch('/api/price-pieces/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, width, height, format: 'png' }),
      })

      if (!exportRes.ok) throw new Error('Export failed')
      const blob = await exportRes.blob()
      const pngUrl = URL.createObjectURL(blob)

      setFrames((prev) =>
        prev.map((f) => f.frame.id === frameId
          ? { ...f, status: 'done', exportedPng: pngUrl } : f)
      )
    } catch (err) {
      setFrames((prev) =>
        prev.map((f) => f.frame.id === frameId
          ? { ...f, status: 'error', error: String(err) } : f)
      )
    }
  }

  // ── Batch render all ready frames ─────────────────────────────────────────

  async function renderAllSelected() {
    const toRender = frames.filter(
      (f) => f.selected && f.status === 'ready' && f.newPrice.trim() && f.priceElements.length > 0
    )
    for (const f of toRender) {
      await renderFrame(f.frame.id)
    }
  }

  // ── Download all exported frames as ZIP ──────────────────────────────────

  async function downloadAll() {
    const done = frames.filter((f) => f.status === 'done' && f.exportedPng)
    if (done.length === 0) return

    // Dynamic import of JSZip
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

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const selectedCount = frames.filter((f) => f.selected).length
  const readyCount = frames.filter((f) => f.status === 'ready').length
  const doneCount = frames.filter((f) => f.status === 'done').length

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* File URL input */}
      <div className="card p-4">
        <label className="block text-xs font-semibold text-gray-700 mb-2">URL del archivo Figma</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={fileUrl}
            onChange={(e) => setFileUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadFile()}
            placeholder="https://www.figma.com/file/XXXXX/Mi-Proyecto"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
          <button
            onClick={handleLoadFile}
            disabled={loading || !fileUrl.trim()}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Cargando...' : 'Cargar Archivo'}
          </button>
        </div>
        {loadError && (
          <p className="text-red-600 text-xs mt-2">{loadError}</p>
        )}
        {fileName && (
          <p className="text-green-700 text-xs mt-2 font-medium">✓ {fileName} — {frames.length} frames encontrados</p>
        )}
      </div>

      {frames.length > 0 && (
        <div className="flex gap-4">
          {/* Frame list (left panel) */}
          <div className="w-72 flex-shrink-0 space-y-2">
            {/* Selection controls */}
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

            {/* Frames */}
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

          {/* Detail panel (right) */}
          <div className="flex-1 space-y-3">
            {/* Global price control */}
            {readyCount > 0 && (
              <div className="card p-4 flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Nuevo precio (aplica a todos los frames listos seleccionados)
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

            {/* Active frame detail */}
            {activeFrame && (
              <FrameDetail
                item={activeFrame}
                onPriceChange={(price) => {
                  setFrames((prev) =>
                    prev.map((f) => f.frame.id === activeFrame.frame.id ? { ...f, newPrice: price } : f)
                  )
                }}
                onRender={() => renderFrame(activeFrame.frame.id)}
              />
            )}

            {!activeFrame && frames.length > 0 && (
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

// ─── FrameCard (sidebar item) ─────────────────────────────────────────────────

function FrameCard({
  item, isActive, onSelect, onClick,
}: {
  item: FrameItem
  isActive: boolean
  onSelect: () => void
  onClick: () => void
}) {
  const statusColor: Record<string, string> = {
    idle: 'bg-gray-100 text-gray-500',
    exporting: 'bg-blue-100 text-blue-600',
    detecting: 'bg-purple-100 text-purple-600',
    ready: 'bg-green-100 text-green-700',
    rendering: 'bg-yellow-100 text-yellow-700',
    done: 'bg-emerald-100 text-emerald-700',
    error: 'bg-red-100 text-red-600',
  }
  const statusLabel: Record<string, string> = {
    idle: 'Pendiente', exporting: 'Exportando...', detecting: 'Detectando...',
    ready: 'Listo', rendering: 'Generando...', done: 'Generado', error: 'Error',
  }

  return (
    <div
      onClick={onClick}
      className={`card p-3 cursor-pointer transition-all ${isActive ? 'ring-2 ring-blue-400' : 'hover:ring-1 hover:ring-gray-200'}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={item.selected}
          onChange={(e) => { e.stopPropagation(); onSelect() }}
          className="mt-0.5 rounded"
          onClick={(e) => e.stopPropagation()}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-800 truncate">{item.frame.name}</p>
          <p className="text-xs text-gray-400 truncate">{item.frame.pageName}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColor[item.status]}`}>
              {statusLabel[item.status]}
            </span>
            {item.frame.priceNodes.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                {item.frame.priceNodes.length} precio{item.frame.priceNodes.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        {item.status === 'done' && (
          <span className="text-emerald-500 text-sm">✓</span>
        )}
      </div>
    </div>
  )
}

// ─── FrameDetail (right panel) ────────────────────────────────────────────────

function FrameDetail({
  item, onPriceChange, onRender,
}: {
  item: FrameItem
  onPriceChange: (price: string) => void
  onRender: () => void
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <span className="font-semibold text-gray-800 text-sm">{item.frame.name}</span>
          <span className="text-gray-400 text-xs ml-2">{item.frame.pageName}</span>
        </div>
        <span className="text-xs text-gray-400">
          {Math.round(item.frame.bounds.width)} × {Math.round(item.frame.bounds.height)} px
        </span>
      </div>

      <div className="p-4 flex gap-4">
        {/* Image preview */}
        <div className="flex-shrink-0">
          {item.status === 'done' && item.exportedPng ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-emerald-700">Resultado con nuevo precio:</p>
              <div className="relative">
                <img
                  src={item.exportedPng}
                  alt={item.frame.name}
                  className="max-w-[220px] max-h-[280px] object-contain rounded border border-gray-200 shadow-sm"
                />
                <a
                  href={item.exportedPng}
                  download={`${item.frame.name}_nuevo_precio.png`}
                  className="mt-2 block text-center text-xs text-blue-600 hover:underline"
                >
                  Descargar PNG
                </a>
              </div>
            </div>
          ) : item.imageBase64 ? (
            <div className="relative">
              <img
                src={item.imageBase64}
                alt={item.frame.name}
                className="max-w-[220px] max-h-[280px] object-contain rounded border border-gray-200"
              />
              {/* Price overlays */}
              {item.priceElements.length > 0 && (
                <div className="absolute inset-0">
                  {item.priceElements.map((el) => (
                    <div
                      key={el.id}
                      className="absolute border-2 border-yellow-400 bg-yellow-400/20 rounded"
                      style={{
                        top: `${el.top}%`,
                        left: `${el.left}%`,
                        minWidth: 40,
                        minHeight: 12,
                      }}
                      title={`Precio detectado: ${el.text}`}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-[180px] h-[240px] bg-gray-100 rounded flex items-center justify-center">
              {item.status === 'exporting' || item.status === 'detecting' ? (
                <span className="text-xs text-gray-400 animate-pulse">
                  {item.status === 'exporting' ? 'Exportando...' : 'Analizando...'}
                </span>
              ) : (
                <span className="text-xs text-gray-400">Sin imagen</span>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-4">
          {/* Detected prices */}
          {item.priceElements.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">
                Precios detectados ({item.priceElements.length}):
              </p>
              <div className="space-y-1">
                {item.priceElements.map((el) => (
                  <div key={el.id} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                    <span className="font-mono text-gray-800">{el.text}</span>
                    <span className="text-gray-400">
                      {el.fontFamily} {el.fontSize}px {el.fontWeight >= 700 ? 'Bold' : 'Regular'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.priceElements.length === 0 && item.status === 'ready' && (
            <div className="p-3 bg-amber-50 rounded border border-amber-100">
              <p className="text-xs text-amber-700">
                No se detectaron precios en este frame. Puede que el precio esté incrustado en una imagen o use un formato no reconocido.
              </p>
            </div>
          )}

          {/* New price input */}
          {(item.status === 'ready' || item.status === 'done' || item.status === 'rendering') && item.priceElements.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Nuevo precio
              </label>
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
                Se usará la misma tipografía ({item.priceElements[0]?.fontFamily}, {item.priceElements[0]?.fontSize}px)
              </p>
            </div>
          )}

          {item.status === 'error' && item.error && (
            <div className="p-3 bg-red-50 rounded border border-red-100">
              <p className="text-xs text-red-700">{item.error}</p>
            </div>
          )}

          {(item.status === 'exporting' || item.status === 'detecting') && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
              {item.status === 'exporting' ? 'Exportando frame desde Figma...' : 'Detectando precios con Gemini...'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Build HTML for re-rendering with new price ───────────────────────────────

function buildPriceHtml(
  backgroundBase64: string,
  priceElements: PriceElement[],
  newPrice: string,
  width: number,
  height: number,
): string {
  const overlays = priceElements.map((el) => {
    const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(2)}%`
    return `<div style="
      position: absolute;
      top: ${pct(el.bounds.y, height)};
      left: ${pct(el.bounds.x, width)};
      width: ${pct(el.bounds.width, width)};
      font-family: '${el.fontFamily}', 'Arial', sans-serif;
      font-size: ${(el.fontSize / height * 100).toFixed(2)}vh;
      font-weight: ${el.fontWeight};
      color: ${el.color};
      white-space: nowrap;
      line-height: 1.1;
    ">${escHtml(newPrice)}</div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
  .frame { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
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
