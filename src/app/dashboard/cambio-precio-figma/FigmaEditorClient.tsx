'use client'

import { useState, useEffect, useCallback } from 'react'
import type { DetectedFrame } from '@/lib/figma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FigmaCampaign {
  id: string
  name: string
  figmaUrl: string
  projectId: string
  createdAt: string
}

interface FigmaProject {
  id: string
  name: string
  macroProject?: string | null
  city?: string | null
  stage?: string | null
  campaigns: FigmaCampaign[]
}


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
  color: string      // CSS rgba (text color)
  containerColor?: string  // CSS rgba — last-resort fill when pixel sampling returns 0 samples
  // Full container geometry — layout reference for coordinate math
  containerBounds?: { top: number; left: number; widthPct: number; heightPct: number }
  containerCornerRadius?: number  // px
  containerOpacity?: number       // 0-1
  containerBlendMode?: string     // Figma blend mode, e.g. 'MULTIPLY'
  // Background classification from vision model — controls erase fill strategy
  backgroundType?: 'solid' | 'image' | 'gradient' | 'transparent'
  backgroundColorHex?: string | null  // #RRGGBB when backgroundType === 'solid'; else null
  // Typography fidelity (all sourced from Figma node.style)
  italic: boolean
  letterSpacing: number      // px
  lineHeightPx: number | null
  textAlignHorizontal: string // LEFT | CENTER | RIGHT | JUSTIFIED
  textCase: string           // UPPER | LOWER | TITLE | ORIGINAL | SMALL_CAPS
  textDecoration: string     // NONE | UNDERLINE | STRIKETHROUGH
}

// DetectedFrame enriched by the hybrid MCP+REST endpoint
interface EnrichedFrame extends DetectedFrame {
  mcpPriceHints?: string[]      // price text strings found by Figma MCP
  mcpHasPriceHints?: boolean
}

interface FrameItem {
  frame: EnrichedFrame
  thumbnail: string | null          // low-res preview (scale 0.3) loaded on file open
  imageBase64: string | null        // high-res (scale 2) loaded on "Procesar"
  backgroundImageBase64: string | null  // export of background node separately
  newBackground: string | null      // user-uploaded replacement for background layer
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
  const [fromCache, setFromCache] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [frames, setFrames] = useState<FrameItem[]>([])
  const [globalPrice, setGlobalPrice] = useState('')
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [renderMode, setRenderMode] = useState<'canvas' | 'ai'>('canvas')

  // ── Project / Campaign state ──────────────────────────────────────────────
  const [projects, setProjects] = useState<FigmaProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [urlSavedToCampaign, setUrlSavedToCampaign] = useState(false)

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null
  const selectedCampaign = selectedProject?.campaigns.find((c) => c.id === selectedCampaignId) || null

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/figma/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects)
      }
    } catch { /* non-fatal */ }
  }, [])

  // Restore last used URL from localStorage or ?url= query param on mount
  useEffect(() => {
    loadProjects()
    const params = new URLSearchParams(window.location.search)
    const queryUrl = params.get('url') || params.get('fileUrl')
    if (queryUrl) {
      setFileUrl(queryUrl)
      return
    }
    const saved = localStorage.getItem(LS_KEY)
    if (saved) setFileUrl(saved)
  }, [loadProjects])

  // When campaign selected: auto-fill URL
  function handleCampaignSelect(campaignId: string) {
    setSelectedCampaignId(campaignId)
    setUrlSavedToCampaign(false)
    const proj = projects.find((p) => p.campaigns.some((c) => c.id === campaignId))
    const camp = proj?.campaigns.find((c) => c.id === campaignId)
    if (camp?.figmaUrl) {
      setFileUrl(camp.figmaUrl)
      localStorage.setItem(LS_KEY, camp.figmaUrl)
    }
  }

  // Auto-save URL to campaign after successful file load
  async function saveUrlToCampaign(campaignId: string, url: string) {
    try {
      await fetch(`/api/figma/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figmaUrl: url }),
      })
      // Update local state
      setProjects((prev) => prev.map((p) => ({
        ...p,
        campaigns: p.campaigns.map((c) =>
          c.id === campaignId ? { ...c, figmaUrl: url } : c
        ),
      })))
      setUrlSavedToCampaign(true)
      setTimeout(() => setUrlSavedToCampaign(false), 3000)
    } catch { /* non-fatal */ }
  }

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
      setFromCache(!!data.fromCache)

      // Auto-save URL to selected campaign if it changed
      if (selectedCampaignId && selectedCampaign?.figmaUrl !== fileUrl.trim()) {
        saveUrlToCampaign(selectedCampaignId, fileUrl.trim())
      }

      const items: FrameItem[] = (data.frames as EnrichedFrame[]).map((f) => ({
        frame: f,
        thumbnail: null,
        imageBase64: null,
        backgroundImageBase64: null,
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

    // 1b. Export background nodes separately (non-fatal) so we can show + replace them
    const bgNodeIds = selected
      .filter((f) => f.frame.backgroundNode)
      .map((f) => f.frame.backgroundNode!.id)

    let bgImageMap: Record<string, string> = {}
    if (bgNodeIds.length > 0) {
      try {
        const bgRes = await fetch('/api/figma', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileKey, frameIds: bgNodeIds, scale: 2 }),
        })
        if (bgRes.ok) {
          const bgData = await bgRes.json()
          bgImageMap = bgData.images || {}
        }
      } catch { /* background export is optional */ }
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

        const bgImg = item.frame.backgroundNode
          ? (bgImageMap[item.frame.backgroundNode.id] || null)
          : null

        setFrames((prev) =>
          prev.map((f) => f.frame.id === item.frame.id
            ? { ...f, imageBase64: img, backgroundImageBase64: bgImg, status: 'detecting' }
            : f)
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

  // ── Apply price to all frames AND render all simultaneously ───────────────

  async function applyAndRenderAll() {
    if (!globalPrice.trim()) return
    const targets = frames.filter(
      (f) => f.selected && (f.status === 'ready' || f.status === 'done') && f.priceElements.length > 0
    )
    if (targets.length === 0) return

    // Set price + rendering status on all targets at once
    setFrames((prev) =>
      prev.map((f) =>
        targets.some((t) => t.frame.id === f.frame.id)
          ? { ...f, newPrice: globalPrice, status: 'rendering' }
          : f
      )
    )

    // Render all in parallel; collect blobs locally so we can ZIP without waiting for state
    type RenderResult = { frameId: string; frameName: string; blob: Blob; pngUrl: string }
    const results: RenderResult[] = []

    await Promise.all(
      targets.map(async (item) => {
        if (!item.imageBase64) return
        try {
          let pngUrl: string

          if (renderMode === 'ai') {
            // ── Mode AI: send image to Gemini for direct editing ──────────────
            const aiRes = await fetch('/api/figma/edit-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageBase64: item.imageBase64, newPrice: globalPrice }),
            })
            if (!aiRes.ok) {
              const errData = await aiRes.json().catch(() => ({ error: 'AI edit failed' }))
              throw new Error(errData.error || 'AI edit failed')
            }
            const { editedImageBase64 } = await aiRes.json()
            if (!editedImageBase64) throw new Error('No se recibió imagen editada')
            const byteStr = atob(editedImageBase64.split(',')[1])
            const mimeStr = editedImageBase64.match(/^data:(image\/\w+)/)?.[1] ?? 'image/png'
            const ab = new ArrayBuffer(byteStr.length)
            const ia = new Uint8Array(ab)
            for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i)
            const blob = new Blob([ab], { type: mimeStr })
            pngUrl = URL.createObjectURL(blob)
            results.push({ frameId: item.frame.id, frameName: item.frame.name, blob, pngUrl })
          } else {
            // ── Mode Canvas: HTML + Playwright ────────────────────────────────
            if (item.priceElements.length === 0) return
            const { width, height, x: frameX, y: frameY } = item.frame.bounds
            let backgroundBounds: { top: number; left: number; widthPct: number; heightPct: number } | null = null
            if (item.frame.backgroundNode) {
              const bg = item.frame.backgroundNode.bounds
              backgroundBounds = {
                top:      (bg.y - frameY) / height * 100,
                left:     (bg.x - frameX) / width  * 100,
                widthPct:  bg.width  / width  * 100,
                heightPct: bg.height / height * 100,
              }
            }
            const html = buildPriceHtml(
              item.imageBase64, item.priceElements, globalPrice,
              width, height, item.newBackground, backgroundBounds, item.backgroundImageBase64,
            )
            const res = await fetch('/api/price-pieces/export', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ html, width, height, format: 'png' }),
            })
            if (!res.ok) throw new Error('Export failed')
            const blob = await res.blob()
            pngUrl = URL.createObjectURL(blob)
            results.push({ frameId: item.frame.id, frameName: item.frame.name, blob, pngUrl })
          }

          setFrames((prev) =>
            prev.map((f) => f.frame.id === item.frame.id
              ? { ...f, newPrice: globalPrice, status: 'done', exportedPng: pngUrl } : f)
          )
        } catch (err) {
          setFrames((prev) =>
            prev.map((f) => f.frame.id === item.frame.id
              ? { ...f, status: 'error', error: String(err) } : f)
          )
        }
      })
    )

    // Auto-package: ZIP all successfully rendered pieces and trigger download
    if (results.length === 0) return
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const seen = new Map<string, number>()
      for (const r of results) {
        const base = r.frameName.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'pieza'
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        const filename = count === 0 ? `${base}_nuevo_precio.png` : `${base}_${count + 1}_nuevo_precio.png`
        zip.file(filename, r.blob)
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `figma_precios_${globalPrice.replace(/[^a-zA-Z0-9]/g, '_')}_${results.length}piezas.zip`
      a.click()
    } catch {
      // ZIP failed — user can still download individually
    }
  }

  // ── Render one frame with new price ──────────────────────────────────────

  async function renderFrame(frameId: string) {
    const item = frames.find((f) => f.frame.id === frameId)
    if (!item?.imageBase64 || !item.newPrice.trim() || item.priceElements.length === 0) return

    setFrames((prev) => prev.map((f) => f.frame.id === frameId ? { ...f, status: 'rendering' } : f))

    try {
      const { width, height, x: frameX, y: frameY } = item.frame.bounds

      // Compute background node bounds as % of frame (for SVG mask + positioning)
      let backgroundBounds: { top: number; left: number; widthPct: number; heightPct: number } | null = null
      if (item.frame.backgroundNode) {
        const bg = item.frame.backgroundNode.bounds
        backgroundBounds = {
          top:      (bg.y - frameY) / height * 100,
          left:     (bg.x - frameX) / width  * 100,
          widthPct:  bg.width  / width  * 100,
          heightPct: bg.height / height * 100,
        }
      }

      const html = buildPriceHtml(
        item.imageBase64,
        item.priceElements,
        item.newPrice,
        width,
        height,
        item.newBackground,
        backgroundBounds,
        item.backgroundImageBase64,
      )

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

  // ── Render one frame with AI image editing ───────────────────────────────

  async function renderFrameWithAI(frameId: string): Promise<void> {
    const item = frames.find((f) => f.frame.id === frameId)
    if (!item?.imageBase64 || !item.newPrice.trim()) return

    setFrames((prev) => prev.map((f) => f.frame.id === frameId ? { ...f, status: 'rendering' } : f))

    try {
      const res = await fetch('/api/figma/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: item.imageBase64,
          newPrice: item.newPrice,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'AI edit failed' }))
        throw new Error(errData.error || 'AI edit failed')
      }

      const { editedImageBase64 } = await res.json()
      if (!editedImageBase64) throw new Error('No se recibió imagen editada')

      // Convert base64 data URL → blob → object URL
      const byteStr = atob(editedImageBase64.split(',')[1])
      const mimeStr = editedImageBase64.match(/^data:(image\/\w+)/)?.[1] ?? 'image/png'
      const ab = new ArrayBuffer(byteStr.length)
      const ia = new Uint8Array(ab)
      for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i)
      const blob = new Blob([ab], { type: mimeStr })
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
    for (const f of toRender) {
      if (renderMode === 'ai') await renderFrameWithAI(f.frame.id)
      else await renderFrame(f.frame.id)
    }
  }

  // ── Download ZIP ──────────────────────────────────────────────────────────

  async function downloadAll() {
    const done = frames.filter((f) => f.status === 'done' && f.exportedPng)
    if (done.length === 0) return

    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    const blobs = await Promise.all(
      done.map(async (item) => {
        const res = await fetch(item.exportedPng!)
        const blob = await res.blob()
        return { name: item.frame.name, blob }
      })
    )

    const seen = new Map<string, number>()
    for (const { name, blob } of blobs) {
      const base = name.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'pieza'
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      const filename = count === 0 ? `${base}_nuevo_precio.png` : `${base}_${count + 1}_nuevo_precio.png`
      zip.file(filename, blob)
    }

    const content = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(content)
    a.download = `figma_precios_${Date.now()}.zip`
    a.click()
  }

  // ── Derived counts ────────────────────────────────────────────────────────

  const selectedCount  = frames.filter((f) => f.selected).length
  const readyCount     = frames.filter((f) => f.status === 'ready').length
  const doneCount      = frames.filter((f) => f.status === 'done').length
  const renderingCount = frames.filter((f) => f.status === 'rendering').length
  const batchTargets   = frames.filter(
    (f) => f.selected && (f.status === 'ready' || f.status === 'done') && f.priceElements.length > 0
  ).length

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Project / Campaign selector */}
      <ProjectCampaignBar
        projects={projects}
        selectedProjectId={selectedProjectId}
        selectedCampaignId={selectedCampaignId}
        onProjectSelect={(id) => { setSelectedProjectId(id); setSelectedCampaignId(null) }}
        onCampaignSelect={handleCampaignSelect}
        onCampaignCreated={(c) => {
          setProjects((prev) => prev.map((p) =>
            p.id === c.projectId ? { ...p, campaigns: [c, ...p.campaigns] } : p
          ))
          handleCampaignSelect(c.id)
        }}
        onCampaignDeleted={(id) => {
          setProjects((prev) => prev.map((p) => ({
            ...p, campaigns: p.campaigns.filter((c) => c.id !== id),
          })))
          if (selectedCampaignId === id) setSelectedCampaignId(null)
        }}
        urlSavedToCampaign={urlSavedToCampaign}
      />

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
            {fromCache && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                ⚡ desde caché
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
            {(readyCount > 0 || doneCount > 0 || renderingCount > 0) && (
              <div className="card p-4 space-y-3">
                {/* Render mode toggle */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-600">Modo:</span>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                    <button
                      onClick={() => setRenderMode('canvas')}
                      className={`px-3 py-1.5 transition-colors ${
                        renderMode === 'canvas'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Canvas
                    </button>
                    <button
                      onClick={() => setRenderMode('ai')}
                      className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${
                        renderMode === 'ai'
                          ? 'bg-violet-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      IA (Gemini)
                    </button>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    {renderMode === 'ai'
                      ? 'Edición directa de imagen con IA'
                      : 'Precisión tipográfica con canvas'}
                  </span>
                </div>

                {/* Batch price input */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Cambiar precio a todas las piezas seleccionadas ({batchTargets})
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={globalPrice}
                      onChange={(e) => setGlobalPrice(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && applyAndRenderAll()}
                      placeholder="Ej: $520.000.000"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={applyAndRenderAll}
                      disabled={!globalPrice.trim() || batchTargets === 0 || renderingCount > 0}
                      className="px-5 py-2 text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                      style={{ background: renderMode === 'ai' ? '#7c3aed' : 'var(--amarilo-navy)' }}
                    >
                      {renderingCount > 0
                        ? `Generando ${renderingCount}...`
                        : `Generar ${batchTargets} piezas`}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Aplica el precio y genera todas las piezas simultáneamente · Enter para confirmar
                  </p>
                </div>

                {/* Download */}
                {doneCount > 0 && (
                  <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
                    <span className="text-xs text-emerald-700 font-medium">
                      {doneCount} {doneCount === 1 ? 'pieza generada' : 'piezas generadas'}
                    </span>
                    <button
                      onClick={downloadAll}
                      className="ml-auto px-4 py-2 text-sm font-semibold rounded-lg hover:opacity-90"
                      style={{ background: 'var(--amarilo-yellow)', color: '#1B3D6B' }}
                    >
                      Descargar ZIP ({doneCount})
                    </button>
                  </div>
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
                onRender={() =>
                  renderMode === 'ai'
                    ? renderFrameWithAI(activeFrame.frame.id)
                    : renderFrame(activeFrame.frame.id)
                }
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

// ─── ProjectCampaignBar ───────────────────────────────────────────────────────
// Projects are read-only (sourced from email briefs).
// Campaigns are created/deleted here and store the Figma URL.

function ProjectCampaignBar({
  projects, selectedProjectId, selectedCampaignId,
  onProjectSelect, onCampaignSelect,
  onCampaignCreated, onCampaignDeleted,
  urlSavedToCampaign,
}: {
  projects: FigmaProject[]
  selectedProjectId: string | null
  selectedCampaignId: string | null
  onProjectSelect: (id: string) => void
  onCampaignSelect: (id: string) => void
  onCampaignCreated: (c: FigmaCampaign) => void
  onCampaignDeleted: (id: string) => void
  urlSavedToCampaign: boolean
}) {
  const [newCampaignName, setNewCampaignName] = useState('')
  const [creatingCampaign, setCreatingCampaign] = useState(false)
  const [showNewCampaign, setShowNewCampaign] = useState(false)

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null
  const campaigns = selectedProject?.campaigns || []

  async function handleCreateCampaign() {
    if (!newCampaignName.trim() || !selectedProjectId) return
    setCreatingCampaign(true)
    try {
      const res = await fetch('/api/figma/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCampaignName, projectId: selectedProjectId }),
      })
      const data = await res.json()
      if (res.ok) {
        onCampaignCreated(data.campaign)
        setNewCampaignName('')
        setShowNewCampaign(false)
      }
    } finally { setCreatingCampaign(false) }
  }

  async function handleDeleteCampaign(id: string) {
    if (!confirm('¿Eliminar esta campaña?')) return
    await fetch(`/api/figma/campaigns/${id}`, { method: 'DELETE' })
    onCampaignDeleted(id)
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-gray-600">Proyecto y Campaña</span>
        {urlSavedToCampaign && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium ml-auto animate-pulse">
            ✓ URL guardada en campaña
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Project selector — read-only, populated from email briefs */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-500 font-medium whitespace-nowrap">Proyecto:</span>
          {projects.length === 0 ? (
            <span className="text-xs text-gray-400 italic">
              Sin proyectos — procesa un brief por email primero
            </span>
          ) : (
            <select
              value={selectedProjectId || ''}
              onChange={(e) => e.target.value && onProjectSelect(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 bg-white max-w-[220px]"
            >
              <option value="">— Seleccionar proyecto —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.city ? ` · ${p.city}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Divider */}
        {selectedProjectId && <span className="text-gray-300 text-sm">/</span>}

        {/* Campaign selector */}
        {selectedProjectId && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-gray-500 font-medium whitespace-nowrap">Campaña:</span>
            <select
              value={selectedCampaignId || ''}
              onChange={(e) => e.target.value && onCampaignSelect(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 bg-white max-w-[200px]"
            >
              <option value="">— Seleccionar campaña —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {selectedCampaignId && (
              <button
                onClick={() => handleDeleteCampaign(selectedCampaignId)}
                className="text-gray-300 hover:text-red-400 text-sm leading-none"
                title="Eliminar campaña"
              >×</button>
            )}
            {!showNewCampaign ? (
              <button
                onClick={() => setShowNewCampaign(true)}
                className="text-[11px] px-2 py-1 rounded border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 whitespace-nowrap"
              >+ Nueva campaña</button>
            ) : (
              <div className="flex gap-1 items-center">
                <input
                  autoFocus
                  type="text"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateCampaign()
                    if (e.key === 'Escape') { setShowNewCampaign(false); setNewCampaignName('') }
                  }}
                  placeholder="Ej: Lanzamiento Mayo 2025"
                  className="text-xs border border-blue-300 rounded px-2 py-1 w-44 focus:outline-none"
                />
                <button
                  onClick={handleCreateCampaign}
                  disabled={creatingCampaign || !newCampaignName.trim()}
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
                >
                  {creatingCampaign ? '...' : 'Crear'}
                </button>
                <button
                  onClick={() => { setShowNewCampaign(false); setNewCampaignName('') }}
                  className="text-xs px-1.5 py-1 text-gray-400 hover:text-gray-600"
                >✕</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Breadcrumb when both selected */}
      {selectedProject && selectedCampaignId && (
        <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1 flex-wrap">
          <span className="font-medium text-gray-600">{selectedProject.name}</span>
          {selectedProject.city && <span>· {selectedProject.city}</span>}
          {selectedProject.stage && (
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{selectedProject.stage}</span>
          )}
          <span className="text-gray-300">›</span>
          <span className="font-medium text-gray-600">{campaigns.find((c) => c.id === selectedCampaignId)?.name}</span>
          <span>· La URL se guarda automáticamente en esta campaña al cargar el archivo.</span>
        </p>
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
  const hasBgNode = !!item.frame.backgroundNode
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
          {/* Background replacement — only shown when a background IMAGE node was detected */}
          {(hasBgNode || item.backgroundImageBase64) && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                Imagen de fondo
                {item.frame.backgroundNode && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-medium font-mono">
                    {item.frame.backgroundNode.name}
                  </span>
                )}
              </p>

              {/* Current background preview */}
              {item.backgroundImageBase64 && (
                <div className="mb-2 flex items-start gap-2">
                  <div className="flex-shrink-0">
                    <p className="text-[10px] text-gray-400 mb-1">Actual</p>
                    <img
                      src={item.backgroundImageBase64}
                      alt="background actual"
                      className="w-24 h-16 object-cover rounded border border-gray-200"
                    />
                  </div>
                  {item.newBackground && (
                    <div className="flex-shrink-0">
                      <p className="text-[10px] text-gray-400 mb-1">Reemplazo</p>
                      <img
                        src={item.newBackground}
                        alt="nuevo background"
                        className="w-24 h-16 object-cover rounded border border-teal-300"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer">
                  <div className={`border border-dashed rounded-lg px-3 py-2 text-xs text-center transition-colors ${item.newBackground ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}>
                    {item.newBackground ? '✓ Nueva imagen cargada — click para cambiar' : 'Subir imagen de reemplazo…'}
                  </div>
                  <input type="file" accept="image/*" onChange={handleBgUpload} className="sr-only" />
                </label>
                {item.newBackground && (
                  <button
                    onClick={() => onBackgroundChange(null)}
                    className="text-xs px-2 py-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    Quitar
                  </button>
                )}
              </div>
              {item.newBackground && item.frame.backgroundNode && (
                <p className="text-[11px] text-gray-400 mt-1">
                  La nueva imagen reemplaza solo el layer <span className="font-mono">{item.frame.backgroundNode.name}</span>.
                  El resto del frame (logos, decoraciones) se preserva.
                </p>
              )}
            </div>
          )}

          {/* Detected prices — style validation summary */}
          {item.priceElements.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">
                Precios detectados ({item.priceElements.length}) — estilos a preservar:
              </p>
              <div className="space-y-2">
                {item.priceElements.map((el) => {
                  const tcLabel = el.textCase && el.textCase !== 'ORIGINAL' ? el.textCase : null
                  const lsLabel = el.letterSpacing ? `LS ${el.letterSpacing > 0 ? '+' : ''}${el.letterSpacing}px` : null
                  const lhLabel = el.lineHeightPx ? `LH ${el.lineHeightPx}px` : null
                  const alignLabel = el.textAlignHorizontal && el.textAlignHorizontal !== 'LEFT' ? el.textAlignHorizontal : null
                  const badges = [
                    el.italic ? 'Italic' : null,
                    tcLabel,
                    lsLabel,
                    lhLabel,
                    alignLabel,
                    el.textDecoration && el.textDecoration !== 'NONE' ? el.textDecoration : null,
                  ].filter(Boolean)
                  return (
                    <div key={el.id} className="bg-amber-50 rounded px-2 py-2 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                        <span className="font-mono font-semibold text-gray-800">{el.text}</span>
                        <span
                          className="ml-auto w-4 h-4 rounded border border-gray-300 flex-shrink-0"
                          style={{ background: el.color }}
                          title={`Color: ${el.color}`}
                        />
                      </div>
                      <div className="flex flex-wrap gap-1 pl-4">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                          {el.fontFamily}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                          {el.fontSize}px
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                          {el.fontWeight >= 700 ? 'Bold' : el.fontWeight >= 500 ? 'Medium' : 'Regular'} ({el.fontWeight})
                        </span>
                        {badges.map((b) => (
                          <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-600">
                            {b}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Todos estos estilos se aplicarán al nuevo precio automáticamente.
              </p>
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
                {item.priceElements[0] && (
                  <>
                    Tipografía: <strong>{item.priceElements[0].fontFamily}</strong>{' '}
                    {item.priceElements[0].fontSize}px · peso {item.priceElements[0].fontWeight}
                    {item.priceElements[0].italic ? ' · Italic' : ''}
                    {item.priceElements[0].textCase && item.priceElements[0].textCase !== 'ORIGINAL'
                      ? ` · ${item.priceElements[0].textCase}` : ''}
                    {item.priceElements[0].letterSpacing
                      ? ` · LS ${item.priceElements[0].letterSpacing}px` : ''}
                  </>
                )}
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
//
// The frame PNG is ALWAYS kept intact — it contains the complete original design
// (background photo, logos, overlays, all design elements). We only paint over
// the price text area and overlay new text on top.
//
// Price-erase strategies (applied per element, best available wins):
//   B1. Bg image crop — copy pixels from exported background node at text position
//   C.  Median sample — zone-out (8 px band outside) + zone-in (PAD rows inside)
//       Both zones together handle solid-color boxes AND photo/gradient backgrounds.

const PRICE_MASK_PAD = 8 // px padding around each price element when no container bounds

function figmaBlendModeToCss(mode: string): string {
  const MAP: Record<string, string> = {
    MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay',
    DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge',
    COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light',
    DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue',
    SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
  }
  return MAP[mode] ?? 'normal'
}

// ─── Typography helpers ───────────────────────────────────────────────────────

function textCaseToCss(textCase: string): string {
  switch (textCase) {
    case 'UPPER': return 'uppercase'
    case 'LOWER': return 'lowercase'
    case 'TITLE': return 'capitalize'
    case 'SMALL_CAPS': return 'none' // handled via font-variant below
    default: return 'none'
  }
}

function textDecorationToCss(d: string): string {
  if (d === 'UNDERLINE') return 'underline'
  if (d === 'STRIKETHROUGH') return 'line-through'
  return 'none'
}

function textAlignToCss(a: string): string {
  if (a === 'CENTER') return 'center'
  if (a === 'RIGHT') return 'right'
  if (a === 'JUSTIFIED') return 'justify'
  return 'left'
}

// Returns a Google Fonts URL for the given family (weight variants 400+700+900).
// Returns empty string if the family is known to be unavailable on GFonts.
function googleFontsUrl(family: string): string {
  if (!family) return ''
  // Known non-Google-Fonts commercial fonts — skip network request
  const NON_GFONTS = new Set([
    'galano grotesque', 'galano grotesque alt', 'gotham', 'avenir', 'proxima nova',
    'futura', 'brandon grotesque', 'helvetica neue', 'helvetica', 'arial',
    'times new roman', 'georgia', 'verdana', 'trebuchet ms',
  ])
  if (NON_GFONTS.has(family.toLowerCase())) return ''
  const encoded = family.replace(/ /g, '+')
  return `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,400;0,700;0,900;1,400;1,700&display=swap`
}

// Build one price overlay <div> that faithfully replicates the Figma node style
function priceOverlayDiv(el: PriceElement, price: string): string {
  const lineH = el.lineHeightPx ? `${el.lineHeightPx}px` : '1.15'
  const fontVariant = el.textCase === 'SMALL_CAPS' ? 'small-caps' : 'normal'
  const styles = [
    'position:absolute', 'z-index:3',
    `top:${el.top.toFixed(3)}%`,
    `left:${el.left.toFixed(3)}%`,
    `width:${el.widthPct.toFixed(3)}%`,
    `min-width:max-content`,
    `font-family:'${el.fontFamily}','Helvetica Neue',Arial,sans-serif`,
    `font-size:${el.fontSize}px`,
    `font-weight:${el.fontWeight}`,
    `font-style:${el.italic ? 'italic' : 'normal'}`,
    `font-variant:${fontVariant}`,
    `color:${el.color}`,
    `letter-spacing:${el.letterSpacing ?? 0}px`,
    `line-height:${lineH}`,
    `text-align:${textAlignToCss(el.textAlignHorizontal ?? 'LEFT')}`,
    `text-transform:${textCaseToCss(el.textCase ?? 'ORIGINAL')}`,
    `text-decoration:${textDecorationToCss(el.textDecoration ?? 'NONE')}`,
    'white-space:nowrap',
    'text-rendering:geometricPrecision',
    '-webkit-font-smoothing:antialiased',
  ].join(';')
  return `<div style="${styles}">${escHtml(price)}</div>`
}

function buildPriceHtml(
  frameBase64: string,
  priceElements: PriceElement[],
  newPrice: string,
  width: number,
  height: number,
  newBackground: string | null = null,
  backgroundBounds: { top: number; left: number; widthPct: number; heightPct: number } | null = null,
  backgroundImageBase64: string | null = null,
): string {
  // Build per-element erase descriptors.
  //
  // Two coordinate sets per element (both kept for layout math; canvas uses tx/ty/tw/th):
  //   x/y/w/h     — container bounds (layout reference; never painted directly)
  //   tx/ty/tw/th — TEXT bounds + PRICE_MASK_PAD (the actual canvas erase area)
  //
  // We NEVER paint a predetermined solid color. The frame PNG is ground truth.
  const priceRectsPx = priceElements.map((el) => {
    // Text-ink erase area — always computed, used by canvas strategies
    const tx = Math.max(0, Math.round(el.left     / 100 * width)  - PRICE_MASK_PAD)
    const ty = Math.max(0, Math.round(el.top      / 100 * height) - PRICE_MASK_PAD)
    const tw = Math.min(width,  Math.round(el.widthPct  / 100 * width)  + PRICE_MASK_PAD * 2)
    const th = Math.min(height, Math.round(el.heightPct / 100 * height) + PRICE_MASK_PAD * 2)

    // Resolve the best solid fill color: Figma structural color takes priority;
    // vision backgroundColorHex is a reliable fallback when Figma tree walk missed it.
    const solidFillColor = el.containerColor
      ?? (el.backgroundType === 'solid' && el.backgroundColorHex ? el.backgroundColorHex : null)

    // backgroundType — normalise: if Figma gave us a containerColor but no vision hint,
    // treat it as solid (the Figma tree walk found a dedicated fill rect).
    const bgType: string = el.backgroundType
      ?? (solidFillColor ? 'solid' : 'unknown')

    if (el.containerBounds) {
      return {
        // Container bounds — layout reference (never directly painted to canvas)
        x: Math.max(0, Math.round(el.containerBounds.left     / 100 * width)),
        y: Math.max(0, Math.round(el.containerBounds.top      / 100 * height)),
        w: Math.min(width,  Math.round(el.containerBounds.widthPct  / 100 * width)),
        h: Math.min(height, Math.round(el.containerBounds.heightPct / 100 * height)),
        // Text bounds — for canvas erase
        tx, ty, tw, th,
        containerColor: solidFillColor,
        cornerRadius: el.containerCornerRadius ?? 0,
        opacity: el.containerOpacity ?? 1,
        blendMode: el.containerBlendMode ?? 'NORMAL',
        backgroundType: bgType,
      }
    }
    return {
      x: tx, y: ty, w: tw, h: th,
      tx, ty, tw, th,
      containerColor: solidFillColor,
      cornerRadius: 0,
      opacity: 1,
      blendMode: 'NORMAL',
      backgroundType: bgType,
    }
  })

  // Price text overlays — one per detected element, full typography fidelity
  const overlays = priceElements.map((el) => priceOverlayDiv(el, newPrice)).join('\n')

  // Font loading — try Google Fonts for each unique family
  const families = [...new Set(priceElements.map((el) => el.fontFamily))]
  const fontLinks = families
    .map(googleFontsUrl)
    .filter(Boolean)
    .map((url) => `<link rel="stylesheet" href="${url}">`)
    .join('\n')

  const baseHead = `<meta charset="utf-8">
${fontLinks}
<script>document.fonts.ready.then(function(){window.__fontsReady=true;});</script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${width}px;height:${height}px;overflow:hidden}
  .frame{position:relative;width:${width}px;height:${height}px;overflow:hidden}
</style>`

  // ── Optional background swap ────────────────────────────────────────────────
  // When the user uploads a new background, show it underneath the frame and
  // mask the frame ONLY at the backgroundNode bounds so design elements stay.
  const effectiveBg = newBackground || null  // only user-uploaded swap, not original
  let bgLayer = ''
  let frameMaskStyle = ''

  if (effectiveBg && backgroundBounds) {
    const bgPx = {
      x: Math.round(backgroundBounds.left     / 100 * width),
      y: Math.round(backgroundBounds.top      / 100 * height),
      w: Math.round(backgroundBounds.widthPct / 100 * width),
      h: Math.round(backgroundBounds.heightPct / 100 * height),
    }
    const svgMask = encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>`
      + `<rect width='${width}' height='${height}' fill='white'/>`
      + `<rect x='${bgPx.x}' y='${bgPx.y}' width='${bgPx.w}' height='${bgPx.h}' fill='black'/>`
      + `</svg>`
    )
    bgLayer = `<img style="position:absolute;z-index:0;`
      + `top:${backgroundBounds.top.toFixed(3)}%;left:${backgroundBounds.left.toFixed(3)}%;`
      + `width:${backgroundBounds.widthPct.toFixed(3)}%;height:${backgroundBounds.heightPct.toFixed(3)}%;`
      + `object-fit:cover;display:block;" src="${effectiveBg}"/>`
    frameMaskStyle = `mask-image:url("data:image/svg+xml,${svgMask}");mask-size:100% 100%;`
  }

  // ── Canvas-only erase (always) ───────────────────────────────────────────────
  // We never paint a predetermined solid color (old Strategy A / B approach).
  // Reason: any color constant — even one sourced from the Figma tree or vision —
  // can be wrong (frame background mistaken for price container, blend modes,
  // gradients, semi-transparency), producing the solid black/blue rectangle artifact.
  //
  // Instead we ALWAYS sample what is ACTUALLY in the frame PNG behind the price text
  // and use that as the fill. The frame PNG is the ground truth.
  //
  // Per element (priority order):
  //   B1  backgroundImageBase64 available → crop pixels from bg-layer export
  //       (most accurate for image backgrounds — uses the exact source layer)
  //   C   always available fallback → multi-zone pixel sampling from the rendered PNG:
  //         zone-out:  8 px band outside the text-ink area (gets surrounding context)
  //         zone-in:   top/bottom PRICE_MASK_PAD rows inside the erase rect
  //                    (above/below the glyphs → picks up the container fill color
  //                     when the price is inside a solid-color box)
  //       Median of all samples → stable fill; last-resort: containerColor if 0 samples.

  const bgPxObj = backgroundBounds ? {
    x: Math.round(backgroundBounds.left     / 100 * width),
    y: Math.round(backgroundBounds.top      / 100 * height),
    w: Math.round(backgroundBounds.widthPct / 100 * width),
    h: Math.round(backgroundBounds.heightPct / 100 * height),
  } : null

  const priceRectsJson = JSON.stringify(priceRectsPx)
  const bgPxJson       = JSON.stringify(bgPxObj)
  // backgroundImageBase64 may be null when there's no named background node
  const hasBgSrc       = !!backgroundImageBase64
  const bgSrcAttr      = hasBgSrc ? `data-bgsrc="${backgroundImageBase64}"` : ''

  // frameMaskStyle on the canvas element handles background-swap masking in canvas mode
  const canvasStyle = `position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;${frameMaskStyle}`

  return `<!DOCTYPE html>
<html><head>${baseHead}
</head><body>
<div class="frame">
  ${bgLayer}
  <canvas id="c" style="${canvasStyle}" width="${width}" height="${height}" ${bgSrcAttr}></canvas>
  ${overlays}
</div>
<script>
(function(){
var W=${width},H=${height};
var priceRects=${priceRectsJson};
var bgPx=${bgPxJson};
var cv=document.getElementById('c');
var ctx=cv.getContext('2d');

var PAD=${PRICE_MASK_PAD};
function eraseRects(bgImgEl){
  priceRects.forEach(function(r){
    var ex=r.tx,ey=r.ty,ew=r.tw,eh=r.th; // text-ink erase area

    // ── B1: background-layer export (most accurate for image backgrounds) ─────
    if(bgImgEl&&bgPx&&bgPx.w>0&&bgPx.h>0){
      ctx.save();
      var sx=bgImgEl.naturalWidth/bgPx.w, sy=bgImgEl.naturalHeight/bgPx.h;
      var srcX=Math.max(0,(ex-bgPx.x)*sx), srcY=Math.max(0,(ey-bgPx.y)*sy);
      var srcW=Math.min(bgImgEl.naturalWidth-srcX,ew*sx);
      var srcH=Math.min(bgImgEl.naturalHeight-srcY,eh*sy);
      if(srcW>0&&srcH>0) ctx.drawImage(bgImgEl,srcX,srcY,srcW,srcH,ex,ey,ew,eh);
      ctx.restore();
      return;
    }

    // ── C: pixel sampling (3 priority zones) ─────────────────────────────────
    ctx.save();
    var samples=[];
    // Only accept fully opaque pixels — transparent areas read as RGB(0,0,0)
    // which would incorrectly pull the median toward black.
    function addPx(d){
      if(!d) return;
      for(var i=0;i<d.length;i+=4){
        if(d[i+3]<200) continue; // skip transparent / semi-transparent
        samples.push([d[i],d[i+1],d[i+2]]);
      }
    }
    function gd(x,y,w,h){
      if(w<1||h<1||x<0||y<0||x+w>W||y+h>H) return null;
      return ctx.getImageData(x,y,w,h).data;
    }

    // Zone 1 — container interior: the space between container bounds (r.x/y/w/h)
    // and the erase rect (ex/ey/ew/eh). These strips are guaranteed clean fill
    // pixels with NO text rendered on them. Most reliable source.
    var cx=r.x,cy=r.y,cw=r.w,ch=r.h;
    if(cw>0&&ch>0){
      var topH=ey-cy;          if(topH>=1) addPx(gd(cx,cy,cw,topH));
      var botH=cy+ch-(ey+eh);  if(botH>=1) addPx(gd(cx,ey+eh,cw,botH));
      var lftW=ex-cx;          if(lftW>=1) addPx(gd(cx,ey,lftW,eh));
      var rgtW=cx+cw-(ex+ew);  if(rgtW>=1) addPx(gd(ex+ew,ey,rgtW,eh));
    }

    // Zone 2 — inner margins of the erase rect (PAD rows at very top and bottom).
    // The erase rect is already padded: ey = text_top - PAD, ey+eh = text_bottom + PAD.
    // So the first/last PAD rows are above/below the actual glyphs — pure container fill.
    // Only sample if Zone 1 did not produce enough reliable data.
    if(samples.length<40){
      var inH=Math.min(PAD,Math.floor(eh/5));
      if(inH>=1){
        addPx(gd(ex,ey,ew,inH));
        addPx(gd(ex,ey+eh-inH,ew,inH));
      }
    }

    // Zone 3 — outer band (8 px outside the erase rect).
    // Useful when there is no container or when Zone 1+2 are insufficient.
    // Added LAST so container-exterior context does not contaminate the median.
    if(samples.length<40){
      addPx(gd(ex,ey-8,ew,8));
      addPx(gd(ex,ey+eh,ew,8));
      addPx(gd(ex-8,ey,8,eh));
      addPx(gd(ex+ew,ey,8,eh));
    }

    if(samples.length>0){
      samples.sort(function(a,b){return(a[0]+a[1]+a[2])-(b[0]+b[1]+b[2]);});
      var m=samples[Math.floor(samples.length/2)];
      ctx.fillStyle='rgb('+m[0]+','+m[1]+','+m[2]+')';
      ctx.fillRect(ex,ey,ew,eh);
    } else if(r.containerColor){
      // True last resort (text at canvas edge, 0 opaque pixels sampled).
      ctx.fillStyle=r.containerColor;
      ctx.fillRect(ex,ey,ew,eh);
    }
    ctx.restore();
  });
  document.fonts.ready.then(function(){window.__ready=true;});
}

var frameImg=new Image();
frameImg.onload=function(){
  ctx.drawImage(frameImg,0,0,W,H);
  var bgsrc=cv.getAttribute('data-bgsrc');
  if(bgsrc){
    var bgImgEl=new Image();
    bgImgEl.onload=function(){eraseRects(bgImgEl);};
    bgImgEl.onerror=function(){eraseRects(null);};
    bgImgEl.src=bgsrc;
  } else {
    eraseRects(null);
  }
};
frameImg.src='${frameBase64}';
})();
</script>
</body></html>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
