'use client'

import { useState, useEffect, useCallback } from 'react'
import type { DetectedFrame } from '@/lib/figma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FigmaCampaign {
  id: string; name: string; figmaUrl: string; projectId: string; createdAt: string
}
interface FigmaProject {
  id: string; name: string; macroProject?: string | null; city?: string | null
  stage?: string | null; campaigns: FigmaCampaign[]
}
interface EnrichedFrame extends DetectedFrame {
  mcpPriceHints?: string[]; mcpHasPriceHints?: boolean
}
interface FrameItem {
  frame: EnrichedFrame
  thumbnail: string | null
  exportedPng: string | null
  status: 'idle' | 'rendering' | 'done' | 'error'
  error?: string
  newPrice: string
  selected: boolean
}

// ─── Main component ───────────────────────────────────────────────────────────

const LS_KEY = 'figma_html_last_url'

export default function FigmaHtmlClient({
  hasFigmaToken,
  defaultPriceLayerName = 'precio',
}: {
  hasFigmaToken: boolean
  defaultPriceLayerName?: string
}) {
  const [fileUrl, setFileUrl] = useState('')
  const [fileKey, setFileKey] = useState('')
  const [fileName, setFileName] = useState('')
  const [fromCache, setFromCache] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [frames, setFrames] = useState<FrameItem[]>([])
  const [globalPrice, setGlobalPrice] = useState('')
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null)
  const [priceLayerName, setPriceLayerName] = useState(defaultPriceLayerName)

  // Project/Campaign
  const [projects, setProjects] = useState<FigmaProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [urlSavedToCampaign, setUrlSavedToCampaign] = useState(false)

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null
  const selectedCampaign = selectedProject?.campaigns.find((c) => c.id === selectedCampaignId) ?? null

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/figma/projects')
      if (res.ok) setProjects((await res.json()).projects)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    loadProjects()
    const params = new URLSearchParams(window.location.search)
    const q = params.get('url') || params.get('fileUrl')
    if (q) { setFileUrl(q); return }
    const saved = localStorage.getItem(LS_KEY)
    if (saved) setFileUrl(saved)
  }, [loadProjects])

  function handleCampaignSelect(id: string) {
    setSelectedCampaignId(id)
    setUrlSavedToCampaign(false)
    const proj = projects.find((p) => p.campaigns.some((c) => c.id === id))
    const camp = proj?.campaigns.find((c) => c.id === id)
    if (camp?.figmaUrl) { setFileUrl(camp.figmaUrl); localStorage.setItem(LS_KEY, camp.figmaUrl) }
  }

  async function saveUrlToCampaign(campaignId: string, url: string) {
    try {
      await fetch(`/api/figma/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figmaUrl: url }),
      })
      setProjects((prev) => prev.map((p) => ({
        ...p, campaigns: p.campaigns.map((c) => c.id === campaignId ? { ...c, figmaUrl: url } : c),
      })))
      setUrlSavedToCampaign(true)
      setTimeout(() => setUrlSavedToCampaign(false), 3000)
    } catch { /* non-fatal */ }
  }

  const activeFrame = frames.find((f) => f.frame.id === activeFrameId) ?? null
  const selectedCount = frames.filter((f) => f.selected).length
  const renderingCount = frames.filter((f) => f.status === 'rendering').length
  const doneCount = frames.filter((f) => f.status === 'done').length
  const batchTargets = frames.filter(
    (f) => f.selected && (f.status === 'idle' || f.status === 'done' || f.status === 'error')
  ).length

  // ── Load Figma file ────────────────────────────────────────────────────────

  async function handleLoadFile() {
    if (!fileUrl.trim()) return
    setLoading(true); setLoadError(''); setFrames([]); setActiveFrameId(null)
    localStorage.setItem(LS_KEY, fileUrl.trim())
    try {
      const res = await fetch(`/api/figma?fileUrl=${encodeURIComponent(fileUrl)}`)
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error || 'Error cargando el archivo'); return }

      setFileKey(data.fileKey)
      setFileName(data.fileName)
      setFromCache(!!data.fromCache)

      if (selectedCampaignId && selectedCampaign?.figmaUrl !== fileUrl.trim()) {
        saveUrlToCampaign(selectedCampaignId, fileUrl.trim())
      }

      const items: FrameItem[] = (data.frames as EnrichedFrame[]).map((f) => ({
        frame: f,
        thumbnail: null,
        exportedPng: null,
        status: 'idle',
        newPrice: '',
        selected: f.priceNodes.length > 0 || (f.mcpHasPriceHints ?? false),
      }))
      setFrames(items)

      const first = items.find((i) => i.frame.priceNodes.length > 0 || i.frame.mcpHasPriceHints)
      if (first) setActiveFrameId(first.frame.id)

      loadThumbnails(data.fileKey, items)
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function loadThumbnails(key: string, items: FrameItem[]) {
    const batchSize = 8
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      try {
        const res = await fetch('/api/figma', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileKey: key, frameIds: batch.map((b) => b.frame.id), scale: 0.3 }),
        })
        if (!res.ok) continue
        const { images } = await res.json()
        setFrames((prev) => prev.map((f) =>
          images[f.frame.id] ? { ...f, thumbnail: images[f.frame.id] } : f
        ))
      } catch { /* non-fatal */ }
    }
  }

  // ── Render single frame via HTML reconstruction ───────────────────────────

  async function renderFrame(frameId: string) {
    const item = frames.find((f) => f.frame.id === frameId)
    if (!item || !item.newPrice.trim()) return

    setFrames((prev) => prev.map((f) =>
      f.frame.id === frameId ? { ...f, status: 'rendering', error: undefined } : f
    ))

    try {
      const res = await fetch('/api/figma/html-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileUrl,
          frameId,
          newPrice: item.newPrice.trim(),
          priceLayerName,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Error de renderizado' }))
        throw new Error(data.error || 'Error de renderizado')
      }

      const blob = await res.blob()
      const pngUrl = URL.createObjectURL(blob)
      setFrames((prev) => prev.map((f) =>
        f.frame.id === frameId ? { ...f, status: 'done', exportedPng: pngUrl } : f
      ))
    } catch (err) {
      setFrames((prev) => prev.map((f) =>
        f.frame.id === frameId ? { ...f, status: 'error', error: String(err) } : f
      ))
    }
  }

  // ── Batch render all selected ─────────────────────────────────────────────

  async function renderAll() {
    if (!globalPrice.trim()) return
    // Apply price to all selected frames first
    setFrames((prev) => prev.map((f) =>
      f.selected ? { ...f, newPrice: globalPrice } : f
    ))

    const targets = frames.filter(
      (f) => f.selected && f.frame.id
    ).map((f) => ({ ...f, newPrice: globalPrice }))

    if (!targets.length) return

    // Mark all as rendering
    setFrames((prev) => prev.map((f) =>
      targets.some((t) => t.frame.id === f.frame.id)
        ? { ...f, status: 'rendering', error: undefined, newPrice: globalPrice }
        : f
    ))

    type RenderResult = { frameId: string; blob: Blob; frameName: string }
    const results: RenderResult[] = []

    await Promise.all(targets.map(async (item) => {
      try {
        const res = await fetch('/api/figma/html-render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileUrl,
            frameId: item.frame.id,
            newPrice: globalPrice.trim(),
            priceLayerName,
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: 'Render error' }))
          throw new Error(d.error || 'Render error')
        }
        const blob = await res.blob()
        const pngUrl = URL.createObjectURL(blob)
        results.push({ frameId: item.frame.id, blob, frameName: item.frame.name })
        setFrames((prev) => prev.map((f) =>
          f.frame.id === item.frame.id ? { ...f, status: 'done', exportedPng: pngUrl } : f
        ))
      } catch (err) {
        setFrames((prev) => prev.map((f) =>
          f.frame.id === item.frame.id ? { ...f, status: 'error', error: String(err) } : f
        ))
      }
    }))

    if (!results.length) return

    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const seen = new Map<string, number>()
      for (const r of results) {
        const base = r.frameName.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'pieza'
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        const filename = count === 0 ? `${base}_precio.png` : `${base}_${count + 1}_precio.png`
        zip.file(filename, r.blob)
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `figma_html_${globalPrice.replace(/[^a-zA-Z0-9]/g, '_')}_${results.length}piezas.zip`
      a.click()
    } catch { /* ZIP failed — user can download individually */ }
  }

  // ── Download single ────────────────────────────────────────────────────────

  function downloadFrame(item: FrameItem) {
    if (!item.exportedPng) return
    const a = document.createElement('a')
    a.href = item.exportedPng
    a.download = `${item.frame.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}_precio.png`
    a.click()
  }

  // ── Download all done ──────────────────────────────────────────────────────

  async function downloadAllDone() {
    const done = frames.filter((f) => f.status === 'done' && f.exportedPng)
    if (!done.length) return
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const seen = new Map<string, number>()
      await Promise.all(done.map(async (f) => {
        const blob = await fetch(f.exportedPng!).then((r) => r.blob())
        const base = f.frame.name.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'pieza'
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        const name = count === 0 ? `${base}.png` : `${base}_${count + 1}.png`
        zip.file(name, blob)
      }))
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `figma_html_${done.length}piezas.zip`
      a.click()
    } catch { /* ZIP failed */ }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setFrames((prev) => prev.map((f) => f.frame.id === id ? { ...f, selected: !f.selected } : f))
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  if (!hasFigmaToken) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-gray-500 text-sm">Token de Figma no configurado.</p>
        <a href="/dashboard/settings" className="text-blue-600 text-sm underline">Ir a Configuración</a>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Precios Figma — Renderizado HTML</h1>
        <p className="text-xs text-gray-500 mt-1">
          Reconstruye cada pieza capa por capa desde Figma y reemplaza el texto de precio directamente,
          sin necesidad de borrar ni superponer imágenes.
        </p>
      </div>

      {/* Project / Campaign bar */}
      <ProjectCampaignBar
        projects={projects}
        selectedProjectId={selectedProjectId}
        selectedCampaignId={selectedCampaignId}
        urlSavedToCampaign={urlSavedToCampaign}
        onProjectSelect={setSelectedProjectId}
        onCampaignSelect={handleCampaignSelect}
        onCampaignCreated={loadProjects}
        onCampaignDeleted={loadProjects}
      />

      {/* URL + Load */}
      <div className="card p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={fileUrl}
            onChange={(e) => setFileUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadFile()}
            placeholder="https://www.figma.com/design/..."
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
          <button
            onClick={handleLoadFile}
            disabled={loading || !fileUrl.trim()}
            className="px-5 py-2 text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--amarilo-navy)' }}
          >
            {loading ? 'Cargando...' : 'Cargar'}
          </button>
        </div>

        {/* Price layer name setting */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Capa de precio:</span>
          <input
            value={priceLayerName}
            onChange={(e) => setPriceLayerName(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:border-blue-400"
            placeholder="precio"
          />
          <span className="text-[11px] text-gray-400">Nombre del layer en Figma</span>
        </div>

        {loadError && <p className="text-red-600 text-xs">{loadError}</p>}
        {fileName && (
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-green-700 text-xs font-medium">
              ✓ {fileName} — {frames.length} frames
              {frames.filter((f) => f.frame.priceNodes.length > 0 || f.frame.mcpHasPriceHints).length > 0 && (
                <span className="ml-1 text-amber-600">
                  ({frames.filter((f) => f.frame.priceNodes.length > 0 || f.frame.mcpHasPriceHints).length} con precios)
                </span>
              )}
            </p>
            {fromCache && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">⚡ caché</span>
            )}
          </div>
        )}
      </div>

      {frames.length > 0 && (
        <div className="flex gap-4">
          {/* Left: frame list */}
          <div className="w-72 flex-shrink-0 space-y-2">
            <div className="card p-3 space-y-2">
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Todos</button>
                <button onClick={selectWithPrices} className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Con precios</button>
                <span className="ml-auto text-xs text-gray-500">{selectedCount} selec.</span>
              </div>
            </div>

            <div className="space-y-1 max-h-[65vh] overflow-y-auto pr-1">
              {frames.map((item) => (
                <button
                  key={item.frame.id}
                  onClick={() => { setActiveFrameId(item.frame.id); if (!item.selected) toggleSelect(item.frame.id) }}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-all text-left ${
                    activeFrameId === item.frame.id
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => toggleSelect(item.frame.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-shrink-0"
                  />
                  {item.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnail} alt="" className="w-10 h-10 object-contain rounded border border-gray-100 flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 bg-gray-100 rounded flex-shrink-0 flex items-center justify-center">
                      <span className="text-gray-300 text-xs">img</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate text-gray-800">{item.frame.name}</p>
                    <p className="text-[10px] text-gray-400">
                      {item.frame.priceNodes.length > 0
                        ? `${item.frame.priceNodes.length} precio(s)`
                        : item.frame.mcpHasPriceHints
                        ? 'precio (MCP)'
                        : 'sin precio detectado'}
                    </p>
                  </div>
                  <StatusDot status={item.status} />
                </button>
              ))}
            </div>
          </div>

          {/* Right: detail */}
          <div className="flex-1 space-y-3">
            {/* Batch controls */}
            <div className="card p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Cambiar precio a todas las piezas seleccionadas ({batchTargets})
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={globalPrice}
                    onChange={(e) => setGlobalPrice(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && renderAll()}
                    placeholder="Ej: $520.000.000"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                  <button
                    onClick={renderAll}
                    disabled={!globalPrice.trim() || batchTargets === 0 || renderingCount > 0}
                    className="px-5 py-2 text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                    style={{ background: 'var(--amarilo-navy)' }}
                  >
                    {renderingCount > 0 ? `Generando ${renderingCount}...` : `Generar ${batchTargets} piezas`}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Renderiza todas las piezas como HTML y exporta ZIP al finalizar · Enter para confirmar
                </p>
              </div>

              {doneCount > 0 && (
                <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                  <span className="text-xs text-green-600 font-medium">{doneCount} piezas generadas</span>
                  <button
                    onClick={downloadAllDone}
                    className="ml-auto px-4 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700"
                  >
                    Descargar todas (.zip)
                  </button>
                </div>
              )}
            </div>

            {/* Active frame detail */}
            {activeFrame && (
              <div className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-800 text-sm">{activeFrame.frame.name}</h3>
                    <p className="text-xs text-gray-400">
                      {activeFrame.frame.bounds.width}×{activeFrame.frame.bounds.height}px
                      · {activeFrame.frame.priceNodes.length} capa(s) de precio
                    </p>
                  </div>
                  {activeFrame.status === 'done' && (
                    <button
                      onClick={() => downloadFrame(activeFrame)}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 flex-shrink-0"
                    >
                      Descargar PNG
                    </button>
                  )}
                </div>

                {/* Price input for this frame */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={activeFrame.newPrice}
                    onChange={(e) => {
                      const val = e.target.value
                      setFrames((prev) => prev.map((f) =>
                        f.frame.id === activeFrame.frame.id ? { ...f, newPrice: val } : f
                      ))
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && renderFrame(activeFrame.frame.id)}
                    placeholder="Nuevo precio..."
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                  <button
                    onClick={() => renderFrame(activeFrame.frame.id)}
                    disabled={!activeFrame.newPrice.trim() || activeFrame.status === 'rendering'}
                    className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    {activeFrame.status === 'rendering' ? 'Renderizando...' : 'Renderizar'}
                  </button>
                </div>

                {activeFrame.error && (
                  <p className="text-red-600 text-xs bg-red-50 rounded p-2">{activeFrame.error}</p>
                )}

                {/* Preview */}
                <div className="flex gap-3">
                  {activeFrame.thumbnail && (
                    <div className="flex-1">
                      <p className="text-[10px] text-gray-400 mb-1 font-medium uppercase tracking-wide">Original</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeFrame.thumbnail}
                        alt="original"
                        className="w-full rounded-lg border border-gray-200 object-contain max-h-80"
                      />
                    </div>
                  )}
                  {(activeFrame.status === 'rendering' || activeFrame.exportedPng) && (
                    <div className="flex-1">
                      <p className="text-[10px] text-gray-400 mb-1 font-medium uppercase tracking-wide">
                        Con nuevo precio
                      </p>
                      {activeFrame.status === 'rendering' ? (
                        <div className="flex items-center justify-center h-40 bg-gray-50 rounded-lg border border-gray-200">
                          <div className="text-center">
                            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                            <p className="text-xs text-gray-500">Reconstruyendo desde Figma...</p>
                          </div>
                        </div>
                      ) : activeFrame.exportedPng ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activeFrame.exportedPng}
                          alt="renderizado"
                          className="w-full rounded-lg border border-green-300 object-contain max-h-80"
                        />
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Price layer info */}
                {activeFrame.frame.priceNodes.length > 0 && (
                  <div className="text-[11px] text-gray-400 bg-gray-50 rounded p-2">
                    <span className="font-medium text-gray-600">Capas detectadas: </span>
                    {activeFrame.frame.priceNodes.map((n) => (
                      <span key={n.id} className="mr-2 text-blue-600">"{n.name}" ({n.text})</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!activeFrame && frames.length > 0 && (
              <div className="card p-8 flex flex-col items-center justify-center text-center text-gray-400">
                <p className="text-sm">Selecciona un frame para previsualizar</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: FrameItem['status'] }) {
  if (status === 'idle') return null
  const color = {
    rendering: 'bg-blue-400 animate-pulse',
    done: 'bg-green-500',
    error: 'bg-red-500',
  }[status] ?? 'bg-gray-300'
  return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
}

// ─── ProjectCampaignBar (same as in FigmaEditorClient) ────────────────────────

interface PCBProps {
  projects: FigmaProject[]
  selectedProjectId: string | null
  selectedCampaignId: string | null
  urlSavedToCampaign: boolean
  onProjectSelect: (id: string) => void
  onCampaignSelect: (id: string) => void
  onCampaignCreated: () => void
  onCampaignDeleted: () => void
}

function ProjectCampaignBar({
  projects, selectedProjectId, selectedCampaignId,
  urlSavedToCampaign, onProjectSelect, onCampaignSelect,
  onCampaignCreated, onCampaignDeleted,
}: PCBProps) {
  const [newCampaignName, setNewCampaignName] = useState('')
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null

  async function createCampaign() {
    if (!newCampaignName.trim() || !selectedProjectId) return
    setCreating(true)
    try {
      await fetch('/api/figma/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCampaignName.trim(), projectId: selectedProjectId }),
      })
      setNewCampaignName(''); setShowForm(false)
      onCampaignCreated()
    } finally { setCreating(false) }
  }

  async function deleteCampaign(id: string) {
    if (!confirm('¿Eliminar campaña?')) return
    await fetch(`/api/figma/campaigns/${id}`, { method: 'DELETE' })
    onCampaignDeleted()
  }

  return (
    <div className="card p-3 flex flex-wrap items-center gap-3">
      {/* Project selector */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-gray-500 whitespace-nowrap">Proyecto:</span>
        {projects.length === 0 ? (
          <span className="text-xs text-gray-400 italic">Sin proyectos — procesa un brief por email primero</span>
        ) : (
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => { onProjectSelect(e.target.value); }}
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
          >
            <option value="">— Seleccionar —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.city ? ` · ${p.city}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Campaign selector */}
      {selectedProject && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Campaña:</span>
          {selectedProject.campaigns.length === 0 ? (
            <span className="text-xs text-gray-400 italic">Sin campañas</span>
          ) : (
            <div className="flex gap-1 flex-wrap">
              {selectedProject.campaigns.map((c) => (
                <div key={c.id} className="flex items-center gap-1">
                  <button
                    onClick={() => onCampaignSelect(c.id)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      selectedCampaignId === c.id
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {c.name}
                  </button>
                  <button
                    onClick={() => deleteCampaign(c.id)}
                    className="text-gray-300 hover:text-red-400 text-xs"
                    title="Eliminar"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="text-xs px-2 py-1 rounded border border-dashed border-gray-300 text-gray-500 hover:border-gray-400"
            >
              + Campaña
            </button>
          ) : (
            <div className="flex gap-1">
              <input
                autoFocus
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createCampaign(); if (e.key === 'Escape') setShowForm(false) }}
                placeholder="Nombre..."
                className="text-xs border border-blue-300 rounded px-2 py-1 focus:outline-none w-28"
              />
              <button
                onClick={createCampaign}
                disabled={creating || !newCampaignName.trim()}
                className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? '...' : 'OK'}
              </button>
              <button onClick={() => setShowForm(false)} className="text-xs px-1 text-gray-400 hover:text-gray-600">✕</button>
            </div>
          )}
        </div>
      )}

      {urlSavedToCampaign && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium ml-auto">
          ✓ URL guardada
        </span>
      )}
    </div>
  )
}
