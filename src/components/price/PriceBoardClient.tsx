'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project { id: string; name: string; city: string; stage: string }

interface PriceZone { x: number; y: number; w: number; h: number } // % coords 0-100

interface PriceConfig {
  zone: PriceZone | null    // where to paint over the old price
  fillColor: string         // color to cover old price text
  textColor: string         // new price text color
  fontSize: number          // % of image height
  fontWeight: string
  textAlign: 'left' | 'center' | 'right'
  showSmmlv: boolean
  smmlvSize: number         // % of image height
  smmlvColor: string
}

interface PricePiece {
  id: string
  name: string
  format: string
  currentPrice: string
  priceSMMLV: string
  imageBase64: string | null
  priceConfig: string
  projectId: string
  project: Project
}

interface PieceParsed extends Omit<PricePiece, 'priceConfig'> {
  cfg: PriceConfig
}

const DEFAULT_CONFIG: PriceConfig = {
  zone: null,
  fillColor: '#1B3D6B',
  textColor: '#FABD02',
  fontSize: 4.5,
  fontWeight: '900',
  textAlign: 'center',
  showSmmlv: true,
  smmlvSize: 2,
  smmlvColor: '#FABD02',
}

function parseCfg(raw: string): PriceConfig {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } } catch { return { ...DEFAULT_CONFIG } }
}

// ─── Canvas render ────────────────────────────────────────────────────────────
// Loads the image onto a canvas, covers the price zone, writes new price text.

async function renderToCanvas(
  canvas: HTMLCanvasElement,
  imageB64: string,
  price: string,
  smmlv: string,
  cfg: PriceConfig,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const W = img.naturalWidth
      const H = img.naturalHeight
      canvas.width  = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!

      // 1. Draw original image
      ctx.drawImage(img, 0, 0)

      if (cfg.zone && (price || smmlv)) {
        const z = cfg.zone
        // Convert % to pixels
        const px = Math.round(z.x / 100 * W)
        const py = Math.round(z.y / 100 * H)
        const pw = Math.round(z.w / 100 * W)
        const ph = Math.round(z.h / 100 * H)

        // 2. Paint over old price
        ctx.fillStyle = cfg.fillColor
        ctx.fillRect(px, py, pw, ph)

        // 3. Render new price text
        const fsize = Math.max(10, Math.round(cfg.fontSize / 100 * H))
        ctx.fillStyle = cfg.textColor
        ctx.font = `${cfg.fontWeight} ${fsize}px Montserrat, Arial, sans-serif`
        ctx.textAlign = cfg.textAlign
        ctx.textBaseline = 'middle'

        const tX = cfg.textAlign === 'center' ? px + pw / 2
          : cfg.textAlign === 'right' ? px + pw - 10 : px + 10

        if (cfg.showSmmlv && smmlv) {
          // Price + SMMLV centered vertically in zone
          const ssize  = Math.max(8, Math.round(cfg.smmlvSize / 100 * H))
          const gap    = 6
          const totalH = fsize + gap + ssize
          const priceY = py + ph / 2 - totalH / 2 + fsize / 2
          const smmlvY = priceY + fsize / 2 + gap + ssize / 2

          if (price) {
            ctx.font = `${cfg.fontWeight} ${fsize}px Montserrat, Arial, sans-serif`
            ctx.fillStyle = cfg.textColor
            ctx.fillText(price, tX, priceY)
          }
          ctx.font      = `700 ${ssize}px Montserrat, Arial, sans-serif`
          ctx.fillStyle = cfg.smmlvColor
          ctx.fillText(smmlv, tX, smmlvY)
        } else if (price) {
          ctx.fillText(price, tX, py + ph / 2)
        }
      }
      resolve()
    }
    img.onerror = reject
    img.src = imageB64
  })
}

// ─── Piece card ───────────────────────────────────────────────────────────────

function PieceCard({ piece, selected, onToggle, livePrice, liveSmmlv, onEdit, onDelete }: {
  piece: PieceParsed; selected: boolean; onToggle: () => void
  livePrice: string; liveSmmlv: string; onEdit: () => void; onDelete: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const PREVIEW_W = 180

  const ratio = piece.format === '16x9' ? 9/16
    : piece.format === '1x1' ? 1
    : piece.format === '4x5' ? 5/4 : 16/9
  const PREVIEW_H = Math.round(PREVIEW_W * ratio)

  const showPrice = livePrice || piece.currentPrice
  const showSmmlv = liveSmmlv || piece.priceSMMLV

  useEffect(() => {
    if (!canvasRef.current || !piece.imageBase64) return
    const canvas = canvasRef.current
    renderToCanvas(canvas, piece.imageBase64, showPrice, showSmmlv, piece.cfg)
      .catch(() => {})
  }, [piece.imageBase64, showPrice, showSmmlv, piece.cfg])

  const stageColor = { EXPECTATIVA: 'bg-pink-100 text-pink-700', LANZAMIENTO: 'bg-orange-100 text-orange-700', SOSTENIMIENTO: 'bg-yellow-100 text-yellow-700' }[piece.project.stage] ?? 'bg-gray-100 text-gray-600'

  return (
    <div className={`relative rounded-xl overflow-hidden border-2 transition-all group cursor-pointer ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-300'}`}>
      {/* Checkbox */}
      <div onClick={onToggle} className={`absolute top-2 left-2 z-20 w-6 h-6 rounded-md flex items-center justify-center text-sm font-bold border-2 transition-all ${selected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-300'}`}>
        {selected && '✓'}
      </div>

      {/* Actions */}
      <div className="absolute top-2 right-2 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onEdit() }} className="w-6 h-6 bg-white rounded shadow text-xs flex items-center justify-center hover:bg-blue-50">✏️</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="w-6 h-6 bg-white rounded shadow text-xs flex items-center justify-center hover:bg-red-50">🗑</button>
      </div>

      {/* Canvas preview */}
      <div onClick={onToggle} style={{ width: PREVIEW_W, height: PREVIEW_H }} className="bg-gray-100 overflow-hidden flex items-center justify-center">
        {piece.imageBase64 ? (
          <canvas
            ref={canvasRef}
            style={{ width: PREVIEW_W, height: PREVIEW_H, display: 'block' }}
          />
        ) : (
          <div className="text-center text-gray-400 text-xs p-4">
            <p className="text-3xl mb-1">🖼</p><p>Sin imagen</p>
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="px-3 py-2 bg-white">
        <p className="text-xs font-semibold text-gray-800 truncate">{piece.name}</p>
        <p className={`text-xs font-bold ${showPrice ? 'text-green-700' : 'text-gray-400'}`}>
          {showPrice || 'Sin precio'}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-xs text-gray-400">{piece.format}</span>
          <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${stageColor}`}>{piece.project.stage.slice(0,3)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Zone selector ────────────────────────────────────────────────────────────
// User drags a rectangle on the image to mark where the price lives.

function ZoneSelector({ imageB64, zone, onChange }: {
  imageB64: string; zone: PriceZone | null; onChange: (z: PriceZone) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [start, setStart]       = useState<{ x: number; y: number } | null>(null)
  const [current, setCurrent]   = useState<{ x: number; y: number } | null>(null)

  function toPercent(e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width)  * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top)  / rect.height) * 100)),
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(true)
    const pt = toPercent(e)
    setStart(pt); setCurrent(pt)
  }
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragging) return
    setCurrent(toPercent(e))
  }
  function onMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragging || !start) return
    setDragging(false)
    const end = toPercent(e)
    const z: PriceZone = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x),
      h: Math.abs(end.y - start.y),
    }
    if (z.w > 1 && z.h > 1) onChange(z)
    setStart(null); setCurrent(null)
  }

  // Compute display rectangle
  const rect = dragging && start && current ? {
    left:   `${Math.min(start.x, current.x)}%`,
    top:    `${Math.min(start.y, current.y)}%`,
    width:  `${Math.abs(current.x - start.x)}%`,
    height: `${Math.abs(current.y - start.y)}%`,
  } : null

  return (
    <div
      ref={containerRef}
      className="relative select-none cursor-crosshair rounded-lg overflow-hidden border border-gray-200"
      style={{ maxWidth: 280 }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { setDragging(false); setStart(null); setCurrent(null) }}
    >
      <img src={imageB64} alt="" className="w-full h-auto pointer-events-none" draggable={false} />

      {/* Existing zone */}
      {zone && !dragging && (
        <div style={{ position: 'absolute', left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%`, border: '2px dashed #22c55e', background: 'rgba(34,197,94,0.15)', pointerEvents: 'none' }}>
          <span className="absolute -top-4 left-0 text-xs bg-green-500 text-white px-1 rounded whitespace-nowrap">Zona del precio</span>
        </div>
      )}

      {/* Dragging preview */}
      {rect && (
        <div style={{ position: 'absolute', ...rect, border: '2px dashed #3b82f6', background: 'rgba(59,130,246,0.15)', pointerEvents: 'none' }} />
      )}
    </div>
  )
}

// ─── Piece modal (add / edit) ─────────────────────────────────────────────────

function PieceModal({ projects, piece, onSave, onClose }: {
  projects: Project[]
  piece: PieceParsed | null
  onSave: (data: Record<string, unknown>) => void
  onClose: () => void
}) {
  const isEdit = !!piece
  const [name,      setName]      = useState(piece?.name      ?? '')
  const [format,    setFormat]    = useState(piece?.format    ?? '9x16')
  const [projectId, setProjectId] = useState(piece?.projectId ?? (projects[0]?.id ?? ''))
  const [price,     setPrice]     = useState(piece?.currentPrice ?? '')
  const [smmlv,     setSmmlv]     = useState(piece?.priceSMMLV  ?? '')
  const [imageB64,  setImageB64]  = useState<string>(piece?.imageBase64 ?? '')
  const [cfg,       setCfg]       = useState<PriceConfig>(piece?.cfg ?? { ...DEFAULT_CONFIG })
  const [tab,       setTab]       = useState<'upload'|'zone'|'style'>('upload')
  const fileRef    = useRef<HTMLInputElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const [previewing, setPreviewing] = useState(false)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = (ev) => setImageB64(ev.target?.result as string ?? '')
    reader.readAsDataURL(f)
  }

  const refreshPreview = useCallback(async () => {
    if (!canvasRef.current || !imageB64) return
    setPreviewing(true)
    try {
      await renderToCanvas(canvasRef.current, imageB64, price || '$293.500.000', smmlv || '135 SMMLV', cfg)
    } finally { setPreviewing(false) }
  }, [imageB64, price, smmlv, cfg])

  useEffect(() => { refreshPreview() }, [refreshPreview])

  // Preview dimensions
  const ratio = format === '16x9' ? 9/16 : format === '1x1' ? 1 : format === '4x5' ? 5/4 : 16/9
  const PW = 260; const PH = Math.round(PW * ratio)

  const TAB = (t: string) => `px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b flex items-center justify-between z-10">
          <h2 className="font-bold text-gray-900">{isEdit ? 'Editar pieza' : 'Subir pieza publicitaria'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>

        <div className="p-6 grid grid-cols-2 gap-6">
          {/* ── Left: form ── */}
          <div className="space-y-4">
            {/* Basic info */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="KV Story Junio 2026"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Formato</label>
                <select value={format} onChange={(e) => setFormat(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                  {[['9x16','Story 9:16'],['1x1','Feed 1:1'],['4x5','Feed 4:5'],['16x9','Portada 16:9']].map(([v,l]) =>
                    <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Campaña *</label>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Precio actual</label>
                <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$293.500.000"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">SMMLV</label>
                <input value={smmlv} onChange={(e) => setSmmlv(e.target.value)} placeholder="135 SMMLV"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setTab('upload')} className={TAB('upload')}>📁 1. Imagen</button>
              <button onClick={() => setTab('zone')}   className={TAB('zone')}>✂️ 2. Zona precio</button>
              <button onClick={() => setTab('style')}  className={TAB('style')}>🎨 3. Estilo</button>
            </div>

            {/* Tab: upload */}
            {tab === 'upload' && (
              <div>
                <div onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                  <p className="text-3xl mb-2">📤</p>
                  <p className="text-sm font-semibold text-gray-700">Subir imagen de la pieza</p>
                  <p className="text-xs text-gray-400 mt-1">JPG o PNG — la imagen completa del anuncio</p>
                  {imageB64 && <p className="text-xs text-green-600 font-medium mt-2 flex items-center justify-center gap-1">✓ Imagen cargada · continúa en "Zona precio"</p>}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                {imageB64 && (
                  <button onClick={() => setImageB64('')} className="mt-2 text-xs text-red-500 hover:text-red-700">Quitar imagen</button>
                )}
              </div>
            )}

            {/* Tab: zone */}
            {tab === 'zone' && (
              <div className="space-y-3">
                {!imageB64 ? (
                  <p className="text-xs text-gray-400 text-center py-4">Primero sube una imagen</p>
                ) : (
                  <>
                    <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
                      <strong>Arrastra un rectángulo</strong> sobre el precio en la imagen de la derecha para marcar la zona que se va a reemplazar.
                    </div>
                    <ZoneSelector imageB64={imageB64} zone={cfg.zone} onChange={(z) => setCfg({ ...cfg, zone: z })} />
                    {cfg.zone && (
                      <div className="bg-green-50 rounded-lg p-2 text-xs text-green-700 flex items-center justify-between">
                        <span>✓ Zona definida: {cfg.zone.w.toFixed(0)}% × {cfg.zone.h.toFixed(0)}%</span>
                        <button onClick={() => setCfg({ ...cfg, zone: null })} className="text-red-500 hover:text-red-700">Borrar zona</button>
                      </div>
                    )}
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Color de cobertura (tapa el precio viejo)</label>
                      <div className="flex gap-2 flex-wrap">
                        {['#1B3D6B','#000000','#FFFFFF','#FABD02','#232323','#f0f0f0'].map((c) => (
                          <button key={c} onClick={() => setCfg({ ...cfg, fillColor: c })}
                            className={`w-7 h-7 rounded border-2 transition-transform ${cfg.fillColor === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                            style={{ background: c }} />
                        ))}
                        <input type="color" value={cfg.fillColor} onChange={(e) => setCfg({ ...cfg, fillColor: e.target.value })}
                          className="w-7 h-7 rounded cursor-pointer border border-gray-200" title="Color personalizado" />
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Elige el color del fondo del área del precio (el fondo del diseño)</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Tab: style */}
            {tab === 'style' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Tamaño precio: {cfg.fontSize}%</label>
                    <input type="range" min="1" max="12" step="0.5" value={cfg.fontSize}
                      onChange={(e) => setCfg({ ...cfg, fontSize: +e.target.value })} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Tamaño SMMLV: {cfg.smmlvSize}%</label>
                    <input type="range" min="0.5" max="6" step="0.5" value={cfg.smmlvSize}
                      onChange={(e) => setCfg({ ...cfg, smmlvSize: +e.target.value })} className="w-full" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Color del texto del precio</label>
                  <div className="flex gap-2">
                    {['#FABD02','#FFFFFF','#000000','#1B3D6B','#FF4444'].map((c) => (
                      <button key={c} onClick={() => setCfg({ ...cfg, textColor: c, smmlvColor: c })}
                        className={`w-7 h-7 rounded-full border-2 ${cfg.textColor === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ background: c }} />
                    ))}
                    <input type="color" value={cfg.textColor} onChange={(e) => setCfg({ ...cfg, textColor: e.target.value, smmlvColor: e.target.value })}
                      className="w-7 h-7 rounded cursor-pointer border border-gray-200" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Alineación</label>
                  <div className="flex gap-2">
                    {(['left','center','right'] as const).map((a) => (
                      <button key={a} onClick={() => setCfg({ ...cfg, textAlign: a })}
                        className={`px-3 py-1 text-xs rounded-lg border ${cfg.textAlign === a ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200'}`}>
                        {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={cfg.showSmmlv} onChange={(e) => setCfg({ ...cfg, showSmmlv: e.target.checked })} />
                  Mostrar línea SMMLV bajo el precio
                </label>
              </div>
            )}
          </div>

          {/* ── Right: live canvas preview ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">Vista previa (resultado final)</p>
              {previewing && <span className="text-xs text-blue-500">Actualizando...</span>}
            </div>
            <div style={{ width: PW, height: PH }} className="rounded-xl overflow-hidden border border-gray-200 bg-gray-100 flex items-center justify-center">
              {imageB64 ? (
                <canvas ref={canvasRef} style={{ width: PW, height: PH }} />
              ) : (
                <div className="text-center text-gray-400 text-xs p-6">
                  <p className="text-4xl mb-2">🖼</p>
                  <p>Sube una imagen para ver la vista previa</p>
                </div>
              )}
            </div>
            {imageB64 && cfg.zone && (
              <p className="text-xs text-green-600 text-center">
                ✓ El precio se escribe directamente sobre la imagen
              </p>
            )}
            {imageB64 && !cfg.zone && (
              <p className="text-xs text-amber-600 text-center bg-amber-50 rounded-lg p-2">
                ⚠ Aún no has marcado la zona del precio. Ve al tab "Zona precio".
              </p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-white px-6 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancelar</button>
          <button onClick={() => onSave({ ...(isEdit ? { id: piece!.id } : {}), name, format, projectId, currentPrice: price, priceSMMLV: smmlv, imageBase64: imageB64 || null, priceConfig: JSON.stringify(cfg), active: true })}
            disabled={!name.trim() || !projectId}
            className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {isEdit ? 'Guardar cambios' : 'Crear pieza'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Board ───────────────────────────────────────────────────────────────

export default function PriceBoardClient({ initialPieces, projects }: {
  initialPieces: PricePiece[]
  projects: Project[]
}) {
  const [pieces, setPieces]       = useState<PieceParsed[]>(initialPieces.map((p) => ({ ...p, cfg: parseCfg(p.priceConfig) })))
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [filterProject, setFP]    = useState('')
  const [newPrice, setNewPrice]   = useState('')
  const [newSmmlv, setNewSmmlv]   = useState('')
  const [applying, setApplying]   = useState(false)
  const [downloading, setDL]      = useState(false)
  const [modal, setModal]         = useState<{ open: boolean; piece: PieceParsed | null }>({ open: false, piece: null })

  const filtered  = pieces.filter((p) => !filterProject || p.projectId === filterProject)
  const byProject = filtered.reduce<Record<string, PieceParsed[]>>((acc, p) => {
    if (!acc[p.projectId]) acc[p.projectId] = []
    acc[p.projectId].push(p); return acc
  }, {})

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function handleSavePiece(data: Record<string, unknown>) {
    const method = data.id ? 'PUT' : 'POST'
    const res = await fetch('/api/price-pieces', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!res.ok) { alert('Error al guardar'); return }
    const saved: PricePiece = await res.json()
    const parsed: PieceParsed = { ...saved, cfg: parseCfg(saved.priceConfig) }
    setPieces((prev) => data.id ? prev.map((p) => p.id === data.id ? parsed : p) : [...prev, parsed])
    setModal({ open: false, piece: null })
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta pieza?')) return
    await fetch(`/api/price-pieces?id=${id}`, { method: 'DELETE' })
    setPieces((prev) => prev.filter((p) => p.id !== id))
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  async function applyPrice() {
    if (!newPrice && !newSmmlv) return
    setApplying(true)
    try {
      const updates = [...selected].map((id) => {
        const p = pieces.find((x) => x.id === id)!
        return { id, currentPrice: newPrice || p.currentPrice, priceSMMLV: newSmmlv || p.priceSMMLV }
      })
      const res = await fetch('/api/price-pieces', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
      if (!res.ok) throw new Error('Error al guardar')
      const updated: PricePiece[] = await res.json()
      setPieces((prev) => prev.map((p) => {
        const u = updated.find((x) => x.id === p.id)
        return u ? { ...p, currentPrice: u.currentPrice, priceSMMLV: u.priceSMMLV } : p
      }))
    } catch (err) { alert(String(err)) }
    finally { setApplying(false) }
  }

  async function downloadSelected() {
    if (selected.size === 0) return
    setDL(true)
    try {
      for (const id of selected) {
        const p = pieces.find((x) => x.id === id)
        if (!p?.imageBase64) continue
        const canvas = document.createElement('canvas')
        const showPrice = newPrice || p.currentPrice
        const showSmmlv = newSmmlv || p.priceSMMLV
        await renderToCanvas(canvas, p.imageBase64, showPrice, showSmmlv, p.cfg)
        const a = document.createElement('a')
        a.href = canvas.toDataURL('image/png')
        a.download = `${p.project.name}-${p.format}-${showPrice.replace(/[$.,\s]/g,'')}.png`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        await new Promise((r) => setTimeout(r, 200))
      }
    } catch (err) { alert('Error: ' + String(err)) }
    finally { setDL(false) }
  }

  const selectedCount = selected.size

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Campaña</label>
          <select value={filterProject} onChange={(e) => setFP(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400">
            <option value="">Todas las campañas</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        {selectedCount > 0 && (
          <button onClick={() => { setSelected(new Set()); setNewPrice(''); setNewSmmlv('') }} className="text-xs text-gray-400 hover:text-gray-600">
            Limpiar selección ({selectedCount})
          </button>
        )}
        <button onClick={() => setSelected(new Set(filtered.map((p) => p.id)))} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          Seleccionar todas ({filtered.length})
        </button>
        <button onClick={() => setModal({ open: true, piece: null })}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700">
          📤 Subir pieza
        </button>
      </div>

      {/* Price change bar */}
      {selectedCount > 0 && (
        <div className="card p-4 bg-blue-50 border-2 border-blue-200 space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex items-center justify-center">{selectedCount}</div>
              <span className="text-sm font-semibold text-blue-800">piezas seleccionadas</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-blue-700 mb-1">Nuevo precio *</label>
              <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="$295.000.000"
                className="border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none w-44" />
            </div>
            <div>
              <label className="block text-xs font-medium text-blue-700 mb-1">SMMLV (opcional)</label>
              <input value={newSmmlv} onChange={(e) => setNewSmmlv(e.target.value)} placeholder="137 SMMLV"
                className="border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none w-36" />
            </div>
            <div className="flex gap-2">
              <button onClick={applyPrice} disabled={applying || (!newPrice && !newSmmlv)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {applying ? '⏳ Guardando...' : '✓ Guardar precio'}
              </button>
              <button onClick={downloadSelected} disabled={downloading}
                className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">
                {downloading ? '⏳ Generando PNG...' : '↓ Descargar PNG'}
              </button>
            </div>
          </div>
          <p className="text-xs text-blue-500">
            El precio se pinta <strong>directamente sobre la imagen original</strong> usando Canvas — se cubre la zona del precio viejo con el color de fondo y se escribe el nuevo precio en el mismo lugar.
          </p>
        </div>
      )}

      {/* Board */}
      {Object.keys(byProject).length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-5xl mb-4">🎨</p>
          <p className="text-gray-600 font-semibold text-lg">No hay piezas aún</p>
          <p className="text-gray-400 text-sm mt-2 max-w-sm mx-auto">
            Sube tus piezas JPG/PNG y marca la zona del precio para poder actualizarlo.
          </p>
          <button onClick={() => setModal({ open: true, piece: null })}
            className="mt-6 px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 text-sm">
            📤 Subir primera pieza
          </button>
        </div>
      ) : (
        Object.entries(byProject).map(([, pjs]) => {
          const proj = pjs[0].project
          const sc = { EXPECTATIVA: 'bg-pink-100 text-pink-700', LANZAMIENTO: 'bg-orange-100 text-orange-700', SOSTENIMIENTO: 'bg-yellow-100 text-yellow-700' }[proj.stage] ?? 'bg-gray-100 text-gray-600'
          return (
            <section key={proj.id} className="space-y-4">
              <div className="flex items-center gap-3 pb-2 border-b border-gray-200">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black" style={{ background: '#1B3D6B' }}>{proj.name.charAt(0)}</div>
                <div>
                  <h3 className="font-bold text-gray-900">{proj.name}</h3>
                  <p className="text-xs text-gray-400">{proj.city}</p>
                </div>
                <span className={`ml-1 text-xs px-2 py-0.5 rounded-full font-medium ${sc}`}>{proj.stage}</span>
                <span className="ml-auto text-xs text-gray-400">{pjs.length} piezas</span>
              </div>
              <div className="flex flex-wrap gap-4">
                {pjs.map((p) => (
                  <PieceCard key={p.id} piece={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)}
                    livePrice={newPrice} liveSmmlv={newSmmlv}
                    onEdit={() => setModal({ open: true, piece: p })}
                    onDelete={() => handleDelete(p.id)} />
                ))}
              </div>
            </section>
          )
        })
      )}

      {modal.open && (
        <PieceModal projects={projects} piece={modal.piece} onSave={handleSavePiece} onClose={() => setModal({ open: false, piece: null })} />
      )}
    </div>
  )
}
