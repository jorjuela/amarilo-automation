'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { renderPieceHtml, FORMAT_SPECS } from '@/lib/price/templates'
import type { AdFormat } from '@/lib/price/templates'

interface Project { id: string; name: string; city: string; stage: string }
interface PricePiece {
  id: string
  name: string
  format: string
  currentPrice: string
  priceSMMLV: string
  areas: string
  tagline: string
  bgImageBase64: string | null
  projectId: string
  project: Project
}

const FORMAT_LABELS: Record<string, string> = {
  '9x16': 'Story 9:16', '1x1': 'Feed 1:1', '4x5': 'Feed 4:5', '16x9': 'Banner 16:9', '4x3': 'Banner 4:3',
}

const STAGE_COLORS: Record<string, string> = {
  EXPECTATIVA: 'bg-pink-100 text-pink-800', LANZAMIENTO: 'bg-orange-100 text-orange-800', SOSTENIMIENTO: 'bg-yellow-100 text-yellow-800',
}

// ─── Piece Preview Card ───────────────────────────────────────────────────────

function PiecePreview({ piece, selected, onToggle, newPrice, newSMMLV }: {
  piece: PricePiece; selected: boolean; onToggle: () => void
  newPrice?: string; newSMMLV?: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const fmt = piece.format as AdFormat
  const spec = FORMAT_SPECS[fmt] ?? FORMAT_SPECS['9x16']
  const scale = 200 / spec.width

  const vars = {
    PROJECT_NAME: piece.project.name,
    CITY: piece.project.city,
    TAGLINE: piece.tagline || `Tu mejor inversión en ${piece.project.city}`,
    PRICE: newPrice || piece.currentPrice,
    SMMLV: newSMMLV || piece.priceSMMLV,
    AREAS: piece.areas,
    BG_URL: piece.bgImageBase64 || '',
  }

  const html = renderPieceHtml(fmt, vars)

  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) { doc.open(); doc.write(html); doc.close() }
    }
  }, [html])

  return (
    <div
      onClick={onToggle}
      className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
        selected ? 'border-blue-500 shadow-lg shadow-blue-200' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {/* Selection checkbox */}
      <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded flex items-center justify-center text-xs font-bold transition-all ${
        selected ? 'bg-blue-500 text-white' : 'bg-white border-2 border-gray-300'
      }`}>
        {selected && '✓'}
      </div>

      {/* Format badge */}
      <div className="absolute top-2 right-2 z-10 px-1.5 py-0.5 bg-black bg-opacity-60 text-white text-xs rounded">
        {FORMAT_LABELS[piece.format] ?? piece.format}
      </div>

      {/* Preview iframe */}
      <div style={{ width: 200, height: Math.round(spec.height * scale) }} className="bg-gray-100">
        <iframe
          ref={iframeRef}
          title={piece.name}
          scrolling="no"
          style={{
            width: spec.width,
            height: spec.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            border: 'none',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Price label */}
      <div className="px-3 py-2 bg-white">
        <p className="text-xs font-semibold text-gray-800 truncate">{piece.name}</p>
        <p className="text-xs text-green-700 font-bold">{newPrice || piece.currentPrice || 'Sin precio'}</p>
        {(newSMMLV || piece.priceSMMLV) && (
          <p className="text-xs text-gray-400">{newSMMLV || piece.priceSMMLV}</p>
        )}
      </div>
    </div>
  )
}

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadPieceAsImage(piece: PricePiece, newPrice: string, newSMMLV: string) {
  const { toPng } = await import('html-to-image')
  const fmt  = piece.format as AdFormat
  const spec = FORMAT_SPECS[fmt] ?? FORMAT_SPECS['9x16']
  const vars = {
    PROJECT_NAME: piece.project.name, CITY: piece.project.city,
    TAGLINE: piece.tagline || `Tu mejor inversión en ${piece.project.city}`,
    PRICE: newPrice || piece.currentPrice, SMMLV: newSMMLV || piece.priceSMMLV,
    AREAS: piece.areas, BG_URL: piece.bgImageBase64 || '',
  }
  const html = renderPieceHtml(fmt, vars)

  // Render in a hidden iframe → capture
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${spec.width}px;height:${spec.height}px;border:none;`
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument!
  doc.open(); doc.write(html); doc.close()

  await new Promise((r) => setTimeout(r, 800)) // wait for fonts

  try {
    const png = await toPng(iframe.contentDocument!.body, { width: spec.width, height: spec.height, pixelRatio: 2 })
    const a = document.createElement('a')
    a.href = png
    a.download = `${piece.project.name}-${piece.format}-${(newPrice || piece.currentPrice).replace(/[$.,\s]/g, '')}.png`
    a.click()
  } finally {
    document.body.removeChild(iframe)
  }
}

// ─── Main Board ───────────────────────────────────────────────────────────────

export default function PriceBoardClient({ initialPieces, projects }: {
  initialPieces: PricePiece[]
  projects: Project[]
}) {
  const [pieces, setPieces]       = useState<PricePiece[]>(initialPieces)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [filterProject, setFilterProject] = useState('')
  const [filterFormat, setFilterFormat]   = useState('')
  const [newPrice, setNewPrice]   = useState('')
  const [newSMMLV, setNewSMMLV]   = useState('')
  const [applying, setApplying]   = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [addForm, setAddForm]     = useState({ name: '', format: '9x16', projectId: projects[0]?.id ?? '', currentPrice: '', priceSMMLV: '', areas: '', tagline: '' })
  const [bgFile, setBgFile]       = useState<File | null>(null)

  const filtered = pieces.filter((p) =>
    (!filterProject || p.projectId === filterProject) &&
    (!filterFormat  || p.format === filterFormat)
  )

  // Group by project
  const byProject = filtered.reduce<Record<string, PricePiece[]>>((acc, p) => {
    const key = p.projectId
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function selectAll() {
    setSelected(new Set(filtered.map((p) => p.id)))
  }

  function clearSelection() { setSelected(new Set()) }

  async function applyPrice() {
    if (!newPrice && !newSMMLV) return
    setApplying(true)
    try {
      const ids = [...selected]
      const updates = ids.map((id) => {
        const p = pieces.find((x) => x.id === id)!
        return { id, currentPrice: newPrice || p.currentPrice, priceSMMLV: newSMMLV || p.priceSMMLV }
      })
      const res = await fetch('/api/price-pieces', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Error al guardar')
      const updated: PricePiece[] = await res.json()
      setPieces((prev) => prev.map((p) => { const u = updated.find((x) => x.id === p.id); return u ?? p }))
      setSelected(new Set())
    } catch (err) { alert(String(err)) }
    finally { setApplying(false) }
  }

  async function downloadSelected() {
    if (selected.size === 0) return
    setDownloading(true)
    try {
      for (const id of selected) {
        const p = pieces.find((x) => x.id === id)!
        await downloadPieceAsImage(p, newPrice || p.currentPrice, newSMMLV || p.priceSMMLV)
        await new Promise((r) => setTimeout(r, 300))
      }
    } catch (err) { alert(String(err)) }
    finally { setDownloading(false) }
  }

  async function handleAdd() {
    let bgBase64 = ''
    if (bgFile) {
      bgBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target?.result as string ?? '')
        reader.readAsDataURL(bgFile)
      })
    }
    const res = await fetch('/api/price-pieces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...addForm, bgImageBase64: bgBase64 || null }),
    })
    if (!res.ok) { alert('Error al crear pieza'); return }
    const created = await res.json()
    const proj = projects.find((p) => p.id === created.projectId)
    setPieces((prev) => [...prev, { ...created, project: proj ?? { id: created.projectId, name: '', city: '', stage: '' } }])
    setShowAdd(false)
    setBgFile(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta pieza?')) return
    await fetch(`/api/price-pieces?id=${id}`, { method: 'DELETE' })
    setPieces((prev) => prev.filter((p) => p.id !== id))
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  const selectedCount = selected.size

  return (
    <div className="space-y-5">
      {/* ── Toolbar ── */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        {/* Filters */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Campaña / Proyecto</label>
          <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400">
            <option value="">Todos los proyectos</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.city}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Formato</label>
          <select value={filterFormat} onChange={(e) => setFilterFormat(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400">
            <option value="">Todos los formatos</option>
            {Object.entries(FORMAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        <div className="flex-1" />

        {/* Selection */}
        <div className="flex items-center gap-2">
          <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Seleccionar todos ({filtered.length})</button>
          {selectedCount > 0 && (
            <button onClick={clearSelection} className="text-xs text-gray-400 hover:text-gray-600">Limpiar ({selectedCount})</button>
          )}
        </div>

        <button onClick={() => setShowAdd(true)}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center gap-1.5">
          + Nueva pieza
        </button>
      </div>

      {/* ── Price change panel (appears when pieces are selected) ── */}
      {selectedCount > 0 && (
        <div className="card p-4 border-2 border-blue-200 bg-blue-50">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">{selectedCount}</span>
              <span className="text-sm font-semibold text-blue-800">piezas seleccionadas</span>
            </div>
            <div>
              <label className="block text-xs text-blue-600 font-medium mb-1">Nuevo precio *</label>
              <input
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="$295.000.000"
                className="border border-blue-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-500 w-40"
              />
            </div>
            <div>
              <label className="block text-xs text-blue-600 font-medium mb-1">SMMLV (opcional)</label>
              <input
                value={newSMMLV}
                onChange={(e) => setNewSMMLV(e.target.value)}
                placeholder="137 SMMLV"
                className="border border-blue-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-500 w-36"
              />
            </div>
            <div className="flex gap-2 mt-4 md:mt-0">
              <button onClick={applyPrice} disabled={applying || (!newPrice && !newSMMLV)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                {applying ? '⏳ Aplicando...' : '✓ Aplicar precio'}
              </button>
              <button onClick={downloadSelected} disabled={downloading}
                className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
                {downloading ? '⏳ Descargando...' : '↓ Descargar imágenes'}
              </button>
            </div>
            <p className="w-full text-xs text-blue-500 mt-1">Las imágenes se generan en el navegador con el precio actualizado (HTML/CSS → PNG). La actualización de precio también se guarda en la base de datos.</p>
          </div>
        </div>
      )}

      {/* ── Boards grouped by project ── */}
      {Object.entries(byProject).length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-4xl mb-3">🎨</p>
          <p className="text-gray-500 font-medium">No hay piezas de publicidad aún</p>
          <p className="text-xs text-gray-400 mt-1">Crea una nueva pieza con el botón "+ Nueva pieza" arriba</p>
        </div>
      ) : (
        Object.entries(byProject).map(([projectId, projectPieces]) => {
          const proj = projectPieces[0].project
          const stageClass = STAGE_COLORS[proj.stage] ?? 'bg-gray-100 text-gray-700'
          return (
            <section key={projectId} className="space-y-3">
              {/* Campaign header */}
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-navy-800 flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: '#1B3D6B' }}>
                  {proj.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">{proj.name}</h3>
                  <p className="text-xs text-gray-400">{proj.city} · <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${stageClass}`}>{proj.stage}</span></p>
                </div>
                <span className="text-xs text-gray-400 ml-auto">{projectPieces.length} piezas</span>
              </div>

              {/* Pieces grid */}
              <div className="flex flex-wrap gap-4">
                {projectPieces.map((p) => (
                  <div key={p.id} className="relative group">
                    <PiecePreview
                      piece={p}
                      selected={selected.has(p.id)}
                      onToggle={() => toggleSelect(p.id)}
                      newPrice={newPrice}
                      newSMMLV={newSMMLV}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full hidden group-hover:flex items-center justify-center leading-none z-20"
                      title="Eliminar pieza"
                    >×</button>
                  </div>
                ))}
              </div>
            </section>
          )
        })
      )}

      {/* ── Add piece modal ── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900">Nueva pieza publicitaria</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                  <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                    placeholder="KV 9x16 - Expectativa" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Formato *</label>
                  <select value={addForm.format} onChange={(e) => setAddForm({ ...addForm, format: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400">
                    {Object.entries(FORMAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Campaña / Proyecto *</label>
                  <select value={addForm.projectId} onChange={(e) => setAddForm({ ...addForm, projectId: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-400">
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.city}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Precio</label>
                  <input value={addForm.currentPrice} onChange={(e) => setAddForm({ ...addForm, currentPrice: e.target.value })}
                    placeholder="$293.500.000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SMMLV</label>
                  <input value={addForm.priceSMMLV} onChange={(e) => setAddForm({ ...addForm, priceSMMLV: e.target.value })}
                    placeholder="135 SMMLV" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Áreas</label>
                  <input value={addForm.areas} onChange={(e) => setAddForm({ ...addForm, areas: e.target.value })}
                    placeholder="44m²" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tagline (opcional)</label>
                  <input value={addForm.tagline} onChange={(e) => setAddForm({ ...addForm, tagline: e.target.value })}
                    placeholder="Tu mejor inversión en..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Imagen de fondo (opcional)</label>
                  <input type="file" accept="image/*" onChange={(e) => setBgFile(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700" />
                  <p className="text-xs text-gray-400 mt-1">JPG/PNG. Se guarda en base64 para renderizado local.</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancelar</button>
              <button onClick={handleAdd} disabled={!addForm.name || !addForm.projectId}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
                Crear pieza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
