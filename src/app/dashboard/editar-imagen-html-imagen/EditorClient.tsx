'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type PieceStatus = 'pending' | 'converting' | 'ready' | 'error'

interface DetectedField { id: string; label: string; value: string }

interface Piece {
  uid: string
  filename: string
  ext: string
  mimeType: string
  base64: string   // imagen original alta resolución — NUNCA se envía a la API
  w: number
  h: number
  status: PieceStatus
  html: string
  fields: DetectedField[]
  error?: string
  progress: number       // 0-100
  progressLabel: string
}

// ─── Field metadata ───────────────────────────────────────────────────────────

const FIELD_META: Record<string, string> = {
  precio: '💰 Precio', smmlv: '% SMMLV', nombre: '🏗 Nombre',
  tagline: '💬 Tagline', badge: '🏷 Badge', subtitulo: '📍 Subtítulo',
  disclaimer: '📝 Disclaimer',
  feat1: '✓ Característica 1', feat2: '✓ Característica 2', feat3: '✓ Característica 3',
}

// ─── Stage labels (for simulated progress during API call) ────────────────────

const STAGES = [
  { min: 0,  label: 'Redimensionando imagen…' },
  { min: 10, label: 'Conectando con Claude Vision…' },
  { min: 20, label: 'Analizando composición de la imagen…' },
  { min: 38, label: 'Detectando textos y posiciones…' },
  { min: 56, label: 'Extrayendo estilos y colores…' },
  { min: 72, label: 'Procesando respuesta del modelo…' },
]

function labelAt(pct: number) {
  return [...STAGES].reverse().find(s => pct >= s.min)?.label ?? 'Iniciando…'
}

// ─── Pure helpers (no React dependencies) ────────────────────────────────────

function makeId() { return Math.random().toString(36).slice(2) }

function fileToB64(file: File | Blob, mime?: string): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader()
    r.onload = e => ok(e.target!.result as string)
    r.onerror = fail
    r.readAsDataURL(mime ? new Blob([file], { type: mime }) : file)
  })
}

function getDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise(ok => {
    const i = new Image()
    i.onload  = () => ok({ w: i.naturalWidth, h: i.naturalHeight })
    i.onerror = () => ok({ w: 540, h: 960 })
    i.src = src
  })
}

function resizeForAI(base64: string, maxDim = 900): Promise<string> {
  return new Promise(ok => {
    const img = new Image()
    img.onload = () => {
      const long = Math.max(img.naturalWidth, img.naturalHeight)
      if (long <= maxDim) { ok(base64); return }
      const s = maxDim / long
      const c = document.createElement('canvas')
      c.width  = Math.round(img.naturalWidth * s)
      c.height = Math.round(img.naturalHeight * s)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      ok(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => ok(base64)
    img.src = base64
  })
}

function extractFields(html: string): DetectedField[] {
  const out: DetectedField[] = []
  const re = /id="([^"]+)"[^>]*>([\s\S]*?)<\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const id = m[1], raw = m[2].replace(/<[^>]+>/g, '').trim()
    if (id in FIELD_META && raw) out.push({ id, label: FIELD_META[id], value: raw })
  }
  return out
}

function patchField(html: string, id: string, val: string) {
  return html.replace(
    new RegExp(`(id="${id}"[^>]*>)([\\s\\S]*?)(<\\/\\w+>)`),
    (_, a, _b, c) => `${a}${val}${c}`
  )
}

// ─── Toast (stable add/rm via useCallback + empty deps) ───────────────────────

type Toast = { id: number; type: 'ok' | 'err' | 'info'; msg: string }

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const add = useCallback((type: Toast['type'], msg: string, ms = 4000) => {
    const id = ++seq.current
    setToasts(p => [...p, { id, type, msg }])
    if (ms > 0) setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), ms)
    return id
  }, [])  // stable — no deps

  const rm = useCallback((id: number) => setToasts(p => p.filter(t => t.id !== id)), [])

  return { toasts, add, rm }
}

// ─── Progress simulation (setInterval, cleanly cancellable) ──────────────────

function startSim(
  uid: string,
  onTick: (uid: string, pct: number, label: string) => void
): () => void {
  const START = Date.now()
  const DURATION = 9000  // sim runs 9s (18%→86%)
  const iv = setInterval(() => {
    const t = Math.min((Date.now() - START) / DURATION, 1)
    const eased = 1 - Math.pow(1 - t, 2.5)
    const pct = Math.round(18 + eased * 68)  // 18 → 86
    onTick(uid, pct, labelAt(pct))
    if (pct >= 86) clearInterval(iv)
  }, 250)
  return () => clearInterval(iv)
}

// ─── ProgressRing SVG ─────────────────────────────────────────────────────────

function ProgressRing({ pct }: { pct: number }) {
  const r = 22, circ = 2 * Math.PI * r
  return (
    <div className="relative w-12 h-12 flex-shrink-0">
      <svg className="-rotate-90 w-12 h-12" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3.5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke="#FABD02" strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(3, (pct / 100) * circ)} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.3s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white text-xs font-bold">{pct}%</span>
      </div>
    </div>
  )
}

// ─── ProcessingPanel ──────────────────────────────────────────────────────────

const LEGEND_STEPS = [
  { label: 'Redimensionar', upTo: 12 },
  { label: 'Conectar',      upTo: 22 },
  { label: 'Analizar IA',   upTo: 80 },
  { label: 'Extraer JSON',  upTo: 92 },
  { label: 'Construir HTML',upTo: 100 },
]

function ProcessingPanel({ pieces }: { pieces: Piece[] }) {
  const active = pieces.filter(p => p.status === 'converting' || p.status === 'pending')
  if (active.length === 0) return null

  const avgPct = Math.round(
    active.reduce((s, p) => s + (p.status === 'pending' ? 0 : p.progress), 0) / active.length
  )

  return (
    <div className="mb-5 rounded-2xl border border-blue-100 bg-white shadow-sm overflow-hidden">

      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 flex items-center gap-3">
        <div className="flex gap-1">
          {[0,1,2].map(i => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce inline-block"
              style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
        <span className="text-sm font-bold text-blue-900">Construyendo HTML con Claude Vision</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-blue-400">{active.length} imagen{active.length > 1 ? 'es' : ''}</span>
          <span className="text-xs font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">{avgPct}%</span>
        </div>
      </div>

      {/* Per-image rows */}
      <div className="divide-y divide-gray-50">
        {active.map(p => {
          const pct   = p.status === 'pending' ? 0 : p.progress
          const label = p.status === 'pending' ? 'En cola…' : (p.progressLabel || 'Iniciando…')
          return (
            <div key={p.uid} className="px-4 py-3 flex items-center gap-3">
              <img src={p.base64} alt="" className="w-8 h-10 object-cover rounded flex-shrink-0 border border-gray-100" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-700 truncate max-w-[200px]">
                    {p.filename}<span className="text-gray-400">.{p.ext}</span>
                  </span>
                  <span className="text-xs font-bold text-blue-600 ml-2">{pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      background: pct < 20 ? '#93C5FD' : pct < 60 ? 'linear-gradient(90deg,#3B82F6,#6366F1)' : 'linear-gradient(90deg,#6366F1,#8B5CF6)',
                    }} />
                </div>
                <p className="text-xs text-gray-400 mt-1 truncate">{label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Pipeline steps legend */}
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-1.5 flex-wrap">
        {LEGEND_STEPS.map((step, i) => {
          const prevUpTo = i > 0 ? LEGEND_STEPS[i - 1].upTo : 0
          const done    = avgPct > step.upTo
          const current = avgPct >= prevUpTo && avgPct <= step.upTo
          return (
            <div key={step.label} className="flex items-center gap-1">
              <span className={`text-xs px-2 py-0.5 rounded-full transition-all ${
                done    ? 'bg-green-100 text-green-700 font-medium' :
                current ? 'bg-blue-100 text-blue-700 font-semibold ring-1 ring-blue-300' :
                          'text-gray-300'
              }`}>
                {done ? '✓' : current ? '⟳' : `${i+1}`} {step.label}
              </span>
              {i < LEGEND_STEPS.length - 1 && (
                <span className={`text-xs ${done ? 'text-green-300' : 'text-gray-200'}`}>→</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── PieceCard ────────────────────────────────────────────────────────────────

function PieceCard({ piece, onEdit, onRemove, onRetry }: {
  piece: Piece; onEdit: () => void; onRemove: () => void; onRetry: () => void
}) {
  const W = 160, scale = W / piece.w, H = Math.round(piece.h * scale)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!iframeRef.current || !piece.html) return
    const doc = iframeRef.current.contentDocument
    if (doc) { doc.open(); doc.write(piece.html); doc.close() }
  }, [piece.html])

  return (
    <div className={`relative group rounded-2xl overflow-hidden border-2 bg-white transition-all ${
      piece.status === 'ready'      ? 'border-gray-200 hover:border-blue-400 hover:shadow-lg cursor-pointer' :
      piece.status === 'converting' ? 'border-blue-300' :
      piece.status === 'error'      ? 'border-red-300' : 'border-gray-200'
    }`}>

      {/* Thumbnail */}
      <div onClick={piece.status === 'ready' ? onEdit : undefined}
        style={{ width: W, height: H }} className="bg-gray-100 overflow-hidden relative">

        {piece.html
          ? <iframe ref={iframeRef} title={piece.filename} scrolling="no"
              style={{ width: piece.w, height: piece.h, transform: `scale(${scale})`, transformOrigin: 'top left', border: 'none', pointerEvents: 'none' }} />
          : <img src={piece.base64} alt="" className="w-full h-full object-cover" />
        }

        {piece.status === 'converting' && (
          <div className="absolute inset-0 bg-gray-950 bg-opacity-75 flex flex-col items-center justify-center gap-2 p-2">
            <ProgressRing pct={piece.progress} />
            <p className="text-white text-xs text-center leading-tight px-1">{piece.progressLabel || 'Iniciando…'}</p>
          </div>
        )}
        {piece.status === 'pending' && (
          <div className="absolute inset-0 bg-gray-900 bg-opacity-50 flex flex-col items-center justify-center gap-1">
            <span className="text-xl">⏳</span>
            <p className="text-white text-xs">En cola</p>
          </div>
        )}
        {piece.status === 'error' && (
          <div className="absolute inset-0 bg-red-900 bg-opacity-65 flex flex-col items-center justify-center gap-2 p-2">
            <p className="text-white text-xs text-center leading-tight">{(piece.error ?? 'Error').slice(0, 60)}</p>
            <button onClick={onRetry} className="px-3 py-1 bg-white text-red-700 text-xs font-bold rounded-lg">Reintentar</button>
          </div>
        )}
        {piece.status === 'ready' && (
          <div className="absolute inset-0 bg-blue-600 bg-opacity-0 group-hover:bg-opacity-20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="text-white text-sm font-bold bg-blue-600 px-3 py-1.5 rounded-lg shadow">✏️ Editar</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5">
        <p className="text-xs font-semibold text-gray-800 truncate">{piece.filename}.{piece.ext}</p>
        <p className="text-xs text-gray-400">{piece.w}×{piece.h} · {piece.ext.toUpperCase()}</p>
        {piece.status === 'converting' && (
          <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${piece.progress}%` }} />
          </div>
        )}
        {piece.status === 'ready' && piece.fields.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {piece.fields.slice(0, 3).map(f => (
              <span key={f.id} className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 px-1.5 py-0.5 rounded truncate max-w-full">
                {f.label.split(' ').slice(1).join(' ')}: {f.value.slice(0, 12)}…
              </span>
            ))}
          </div>
        )}
      </div>

      <button onClick={onRemove}
        className="absolute top-1.5 right-1.5 w-5 h-5 bg-black bg-opacity-50 text-white text-xs rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        ×
      </button>
    </div>
  )
}

// ─── PieceEditor ──────────────────────────────────────────────────────────────

function PieceEditor({ piece, onClose, onHtmlChange, onExport }: {
  piece: Piece; onClose: () => void; onHtmlChange: (h: string) => void; onExport: (p: Piece) => void
}) {
  const [html,     setHtml]     = useState(piece.html)
  const [liveHtml, setLiveHtml] = useState(piece.html)
  const [fields,   setFields]   = useState(piece.fields)
  const [tab,      setTab]      = useState<'fields'|'html'>('fields')
  const [split,    setSplit]    = useState(42)
  const [dragging, setDragging] = useState(false)
  const iframeRef  = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { const t = setTimeout(() => setLiveHtml(html), 300); return () => clearTimeout(t) }, [html])
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc && liveHtml) { doc.open(); doc.write(liveHtml); doc.close() }
  }, [liveHtml])
  useEffect(() => {
    if (!dragging) return
    const mv = (e: MouseEvent) => {
      const r = containerRef.current?.getBoundingClientRect()
      if (r) setSplit(Math.max(24, Math.min(72, ((e.clientX - r.left) / r.width) * 100)))
    }
    const up = () => setDragging(false)
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [dragging])

  const updField = (id: string, val: string) => {
    const next = patchField(html, id, val)
    setHtml(next); onHtmlChange(next)
    setFields(prev => prev.map(f => f.id === id ? { ...f, value: val } : f))
  }
  const updHtml = (next: string) => { setHtml(next); onHtmlChange(next); setFields(extractFields(next)) }

  const scale = Math.min(1, 520 / piece.w, 700 / piece.h)
  const CLS = (t: string) => `px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-gray-200">
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 font-medium">← Volver</button>
        <span className="text-gray-200">|</span>
        <span className="font-bold text-gray-900 text-sm">{piece.filename}.{piece.ext}</span>
        <span className="text-xs text-gray-400">{piece.w}×{piece.h}px</span>
        <div className="flex gap-2 ml-2">
          <button onClick={() => setTab('fields')} className={CLS('fields')}>🎯 Campos detectados</button>
          <button onClick={() => setTab('html')} className={CLS('html')}>⌨️ HTML</button>
        </div>
        <div className="flex-1" />
        <button onClick={() => onExport({ ...piece, html })}
          className="px-5 py-2 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700">
          ↓ Exportar {piece.ext.toUpperCase()}
        </button>
      </div>

      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col overflow-hidden" style={{ width: `${split}%` }}>
          {tab === 'fields' && (
            <>
              <div className="flex-shrink-0 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <p className="text-xs font-semibold text-gray-500">CAMPOS DETECTADOS</p>
                <p className="text-xs text-gray-400 mt-0.5">Edita y el preview se actualiza en tiempo real</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {fields.length === 0
                  ? <div className="text-center py-8 text-gray-400"><p className="text-3xl mb-2">🔍</p><p className="text-sm">No se detectaron campos. Usa el tab HTML.</p></div>
                  : fields.map(f => (
                    <div key={f.id}>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                      <input value={f.value} onChange={e => updField(f.id, e.target.value)}
                        className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                          f.id === 'precio' ? 'border-yellow-300 bg-yellow-50 font-bold text-yellow-900' :
                          f.id === 'smmlv'  ? 'border-yellow-200 bg-yellow-50 text-yellow-800' : 'border-gray-200'}`} />
                    </div>
                  ))
                }
              </div>
            </>
          )}
          {tab === 'html' && (
            <>
              <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-700">
                <span className="text-xs font-mono font-semibold text-gray-400">HTML</span>
                <span className="text-xs text-gray-500">{html.split('\n').length} líneas</span>
              </div>
              <textarea value={html} onChange={e => updHtml(e.target.value)} spellCheck={false}
                className="flex-1 p-4 font-mono text-xs bg-gray-950 text-green-300 resize-none focus:outline-none leading-5"
                style={{ tabSize: 2 }} />
            </>
          )}
        </div>

        <div onMouseDown={() => setDragging(true)}
          className={`flex-shrink-0 w-1.5 cursor-col-resize ${dragging ? 'bg-blue-500' : 'bg-gray-200 hover:bg-blue-400'}`} />

        <div className="flex flex-col flex-1 overflow-hidden bg-gray-100">
          <div className="flex-shrink-0 px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">PREVIEW EN VIVO</span>
            <span className="text-xs text-gray-400">Se actualiza automáticamente</span>
          </div>
          <div className="flex-1 overflow-auto flex items-start justify-center pt-8 px-6 pb-6">
            <div style={{ width: Math.round(piece.w * scale), height: Math.round(piece.h * scale), flexShrink: 0 }}
              className="rounded-xl overflow-hidden shadow-2xl">
              <iframe ref={iframeRef} title="preview"
                style={{ width: piece.w, height: piece.h, border: 'none', display: 'block', transform: `scale(${scale})`, transformOrigin: 'top left' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EditorClient() {
  const [pieces,  setPieces]  = useState<Piece[]>([])
  const [editing, setEditing] = useState<Piece | null>(null)
  const [dragOver,setDragOver]= useState(false)
  const [mounted, setMounted] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const zipRef  = useRef<HTMLInputElement>(null)
  const { toasts, add, rm } = useToast()

  useEffect(() => { setMounted(true) }, [])

  // ── Queue: simple while-loop, no recursive calls, no stale closures ────────
  // Queue stores full Piece objects so we never need to read React state async.

  const queue      = useRef<Piece[]>([])
  const running    = useRef(false)

  // setPieces is stable (React guarantee). add is stable (useCallback + []).
  // We capture them in refs so the queue runner can use them without re-creating.
  const setPiecesRef = useRef(setPieces)
  const addRef       = useRef(add)
  useEffect(() => { setPiecesRef.current = setPieces }, [setPieces])
  useEffect(() => { addRef.current = add },              [add])

  const patch = useCallback((uid: string, update: Partial<Piece>) => {
    setPiecesRef.current(prev => prev.map(p => p.uid === uid ? { ...p, ...update } : p))
  }, [])

  const runQueue = useCallback(async () => {
    if (running.current) return
    running.current = true

    while (queue.current.length > 0) {
      const piece = queue.current.shift()!

      // ── Step 1: mark converting
      patch(piece.uid, { status: 'converting', progress: 3, progressLabel: 'Redimensionando imagen…' })

      let stopSim = () => {}
      const ctrl  = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 55000)  // 55s hard timeout

      try {
        // ── Step 2: resize for AI (client-side, instant)
        const aiImage = await resizeForAI(piece.base64)

        // ── Step 3: start progress simulation while API call runs
        patch(piece.uid, { progress: 15, progressLabel: 'Conectando con Claude Vision…' })
        stopSim = startSim(piece.uid, (uid, pct, label) => patch(uid, { progress: pct, progressLabel: label }))

        // ── Step 4: call API
        const resp = await fetch('/api/image-editor/to-html', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiImageBase64: aiImage, width: piece.w, height: piece.h }),
          signal: ctrl.signal,
        })

        stopSim()
        clearTimeout(timer)

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${resp.status}`)
        }

        const data = await resp.json()

        // ── Step 5: parse + build
        patch(piece.uid, { progress: 88, progressLabel: 'Parseando estructura JSON…' })
        const html   = (data.html ?? '').replace(/src=["']PLACEHOLDER["']/g, `src="${piece.base64}"`)
        const fields = extractFields(html)

        patch(piece.uid, { progress: 95, progressLabel: 'Construyendo HTML…' })
        await new Promise(r => setTimeout(r, 40))

        // ── Step 6: done
        patch(piece.uid, { status: 'ready', html, fields, progress: 100, progressLabel: 'Listo ✓' })
        addRef.current('ok', `✓ ${piece.filename} convertida`)

      } catch (err: unknown) {
        stopSim()
        clearTimeout(timer)
        const msg = ctrl.signal.aborted
          ? 'Tiempo de espera agotado (55s). Reintenta.'
          : (err instanceof Error ? err.message : String(err))
        patch(piece.uid, { status: 'error', error: msg, progress: 0, progressLabel: '' })
        addRef.current('err', `Error: ${msg.slice(0, 80)}`)
      }
    }

    running.current = false
  }, [patch])

  function enqueue(pieces: Piece[]) {
    queue.current.push(...pieces)
    runQueue()
  }

  // ── Build piece ────────────────────────────────────────────────────────────

  function mkPiece(name: string, ext: string, mime: string, b64: string, w: number, h: number): Piece {
    return { uid: makeId(), filename: name, ext, mimeType: mime, base64: b64, w, h, status: 'pending', html: '', fields: [], progress: 0, progressLabel: '' }
  }

  // ── Add images ──────────────────────────────────────────────────────────────

  async function addImages(files: File[]) {
    const imgs = files.filter(f => f.type.startsWith('image/'))
    if (!imgs.length) { add('err', 'No se encontraron imágenes'); return }

    const newP: Piece[] = []
    for (const f of imgs) {
      if (f.size > 20 * 1024 * 1024) { add('err', `${f.name} supera 20 MB`); continue }
      const b64 = await fileToB64(f)
      const { w, h } = await getDims(b64)
      const parts = f.name.split('.'), ext = parts.pop()?.toLowerCase() ?? 'jpg'
      newP.push(mkPiece(parts.join('.'), ext, f.type, b64, w, h))
    }
    if (!newP.length) return
    setPieces(prev => [...prev, ...newP])
    add('info', `${newP.length} imagen${newP.length > 1 ? 'es' : ''} añadida${newP.length > 1 ? 's' : ''}`)
    enqueue(newP)
  }

  async function addZip(file: File) {
    const tid = add('info', `Extrayendo ${file.name}…`, 0)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = await (new JSZip()).loadAsync(file)
      const entries: { name: string; data: Uint8Array; mime: string }[] = []
      for (const [n, e] of Object.entries(zip.files)) {
        if (e.dir || !/\.(jpe?g|png|webp)$/i.test(n)) continue
        const data = await e.async('uint8array')
        const mime = /\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : 'image/jpeg'
        entries.push({ name: n.split('/').pop() ?? n, data, mime })
      }
      rm(tid)
      if (!entries.length) { add('err', 'No se encontraron imágenes en el ZIP'); return }

      const newP: Piece[] = []
      for (const { name, data, mime } of entries) {
        const b64 = await fileToB64(new Blob([data.buffer as ArrayBuffer], { type: mime }), mime)
        const { w, h } = await getDims(b64)
        const parts = name.split('.'), ext = parts.pop()?.toLowerCase() ?? 'jpg'
        newP.push(mkPiece(parts.join('.'), ext, mime, b64, w, h))
      }
      setPieces(prev => [...prev, ...newP])
      add('ok', `${newP.length} imágenes extraídas del ZIP`)
      enqueue(newP)
    } catch (e) { rm(tid); add('err', 'Error leyendo ZIP: ' + String(e)) }
  }

  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    arr.filter(f => f.type === 'application/zip' || f.name.endsWith('.zip')).forEach(addZip)
    const imgs = arr.filter(f => f.type.startsWith('image/'))
    if (imgs.length) addImages(imgs)
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  async function exportPiece(p: Piece) {
    const tid = add('info', `Exportando ${p.filename}…`, 0)
    try {
      const res = await fetch('/api/price-pieces/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: p.html, width: p.w, height: p.h, filename: `${p.filename}.${p.ext}`, format: p.ext === 'png' ? 'png' : 'jpeg' }),
      })
      rm(tid)
      if (!res.ok) throw new Error((await res.json()).error)
      const blob = await res.blob()
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${p.filename}.${p.ext}` })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      add('ok', `✓ ${p.filename}.${p.ext} exportado`)
    } catch (e) { rm(tid); add('err', String(e)) }
  }

  async function exportAll() {
    const ready = pieces.filter(p => p.status === 'ready')
    if (!ready.length) { add('err', 'No hay imágenes listas'); return }
    for (const p of ready) { await exportPiece(p); await new Promise(r => setTimeout(r, 300)) }
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  const ready      = pieces.filter(p => p.status === 'ready').length
  const converting = pieces.filter(p => p.status === 'converting').length
  const pending    = pieces.filter(p => p.status === 'pending').length
  const errors     = pieces.filter(p => p.status === 'error').length

  if (!mounted) return <div className="h-screen bg-gray-50" />

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">Editor Imagen → HTML → Imagen</h1>
          <p className="text-xs text-gray-400 mt-0.5">Sube imágenes o ZIP · Claude Vision convierte a HTML · edita · exporta</p>
        </div>
        {pieces.length > 0 && (
          <div className="flex items-center gap-2 ml-4">
            {ready      > 0 && <span className="text-xs bg-green-100 text-green-700 font-semibold px-2.5 py-1 rounded-full">✓ {ready} listas</span>}
            {converting > 0 && <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2.5 py-1 rounded-full animate-pulse">⚙ {converting} convirtiendo</span>}
            {pending    > 0 && <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2.5 py-1 rounded-full">⏳ {pending} en cola</span>}
            {errors     > 0 && <span className="text-xs bg-red-100 text-red-700 font-semibold px-2.5 py-1 rounded-full">✗ {errors} errores</span>}
          </div>
        )}
        <div className="flex-1" />
        <div className="flex gap-2">
          <button onClick={() => fileRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">🖼 Imágenes</button>
          <button onClick={() => zipRef.current?.click()}  className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">📦 ZIP</button>
          {ready > 0 && <button onClick={exportAll} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700">↓ Exportar ({ready})</button>}
          {pieces.length > 0 && <button onClick={() => setPieces([])} className="px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl hover:bg-gray-200">Limpiar</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />
        <input ref={zipRef}  type="file" accept=".zip,application/zip" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) addZip(f); e.target.value = '' }} />
      </header>

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-auto p-5">
        {pieces.length === 0 ? (

          <div className="h-full flex items-center justify-center min-h-80">
            <div onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              className={`w-full max-w-2xl rounded-3xl border-2 border-dashed p-16 text-center cursor-pointer transition-all ${dragOver ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}>
              <div className="text-6xl mb-5">📤</div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Arrastra imágenes o un ZIP aquí</h2>
              <p className="text-gray-400 text-sm mb-6">JPG · PNG · WEBP · o un archivo .ZIP con múltiples imágenes</p>
              <div className="flex gap-4 justify-center">
                <button onClick={e => { e.stopPropagation(); fileRef.current?.click() }} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 text-sm">Seleccionar imágenes</button>
                <button onClick={e => { e.stopPropagation(); zipRef.current?.click() }}  className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 text-sm">Cargar ZIP</button>
              </div>
              <div className="mt-8 grid grid-cols-3 gap-4 text-left max-w-lg mx-auto">
                {[
                  { icon: '⚡', t: 'Rápido',       d: 'JSON compacto: 5-8× menos tokens que HTML' },
                  { icon: '✏️', t: 'Edita fácil',  d: 'Precio, nombre, tagline detectados' },
                  { icon: '📸', t: 'Fiel',          d: 'Exporta en PNG o JPG, mismo tamaño' },
                ].map(c => (
                  <div key={c.t} className="bg-white rounded-xl p-3 shadow-sm">
                    <div className="text-2xl mb-1">{c.icon}</div>
                    <p className="text-xs font-bold text-gray-700">{c.t}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{c.d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

        ) : (

          <div onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }} onDragOver={e => e.preventDefault()}>
            {/* Panel de progreso de construcción */}
            <ProcessingPanel pieces={pieces} />

            <div className="flex flex-wrap gap-4">
              {pieces.map(p => (
                <PieceCard key={p.uid} piece={p}
                  onEdit={()   => setEditing(p)}
                  onRemove={()  => setPieces(prev => prev.filter(x => x.uid !== p.uid))}
                  onRetry={()  => {
                    setPieces(prev => prev.map(x => x.uid === p.uid ? { ...x, status: 'pending', error: undefined, progress: 0, progressLabel: '' } : x))
                    queue.current.push(p)
                    runQueue()
                  }}
                />
              ))}
              <div onClick={() => fileRef.current?.click()}
                className="w-40 h-52 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all text-gray-400 hover:text-blue-500">
                <span className="text-3xl">+</span>
                <span className="text-xs font-medium">Agregar más</span>
              </div>
            </div>
          </div>

        )}
      </main>

      {/* Editor */}
      {editing && (
        <PieceEditor piece={editing} onClose={() => setEditing(null)}
          onHtmlChange={html => {
            setPieces(prev => prev.map(p => p.uid === editing.uid ? { ...p, html, fields: extractFields(html) } : p))
            setEditing(prev => prev ? { ...prev, html, fields: extractFields(html) } : null)
          }}
          onExport={exportPiece}
        />
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-xs pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} onClick={() => rm(t.id)}
            className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 cursor-pointer ${
              t.type === 'ok' ? 'bg-green-600 text-white' : t.type === 'err' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
            <span>{t.type === 'ok' ? '✓' : t.type === 'err' ? '✗' : '⏳'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
