'use client'

import { useState, useRef, useEffect, useCallback, useId } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type PieceStatus = 'pending' | 'converting' | 'ready' | 'error'

interface DetectedField {
  id: string
  label: string
  value: string
}

interface Piece {
  uid: string
  filename: string          // without extension
  ext: string               // 'jpg' | 'png' | 'webp'
  mimeType: string
  base64: string            // original image
  w: number
  h: number
  status: PieceStatus
  html: string
  fields: DetectedField[]   // auto-detected editable fields
  error?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_META: Record<string, string> = {
  precio:     '💰 Precio',
  smmlv:      '% SMMLV',
  nombre:     '🏗 Nombre',
  tagline:    '💬 Tagline',
  badge:      '🏷 Badge',
  disclaimer: '📝 Disclaimer',
  feat1: '✓ Característica 1',
  feat2: '✓ Característica 2',
  feat3: '✓ Característica 3',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }

async function fileToB64(file: File | Blob, mime?: string): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload  = (e) => res(e.target!.result as string)
    r.onerror = rej
    r.readAsDataURL(mime ? new Blob([file], { type: mime }) : file)
  })
}

async function getDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const i = new Image()
    i.onload  = () => res({ w: i.naturalWidth, h: i.naturalHeight })
    i.onerror = () => res({ w: 540, h: 960 })
    i.src = src
  })
}

function extractFields(html: string): DetectedField[] {
  const out: DetectedField[] = []
  // Match <tag ... id="X" ...>CONTENT</tag>
  const re = /id="([^"]+)"[^>]*>([\s\S]*?)<\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const id  = m[1]
    const raw = m[2].replace(/<[^>]+>/g, '').trim()
    if (id in FIELD_META && raw) {
      out.push({ id, label: FIELD_META[id], value: raw })
    }
  }
  return out
}

function applyFieldChange(html: string, id: string, newVal: string): string {
  return html.replace(
    new RegExp(`(id="${id}"[^>]*>)([\\s\\S]*?)(<\\/\\w+>)`),
    (_, open, _old, close) => `${open}${newVal}${close}`
  )
}

// ─── Toast hook ───────────────────────────────────────────────────────────────

function useToast() {
  const [toasts, set] = useState<{ id: number; type: 'ok'|'err'|'info'; msg: string }[]>([])
  const n = useRef(0)
  const add = (type: 'ok'|'err'|'info', msg: string, ms = 4000) => {
    const id = ++n.current
    set((p) => [...p, { id, type, msg }])
    if (ms > 0) setTimeout(() => set((p) => p.filter((t) => t.id !== id)), ms)
    return id
  }
  const rm = (id: number) => set((p) => p.filter((t) => t.id !== id))
  return { toasts, add, rm }
}

// ─── PieceCard ────────────────────────────────────────────────────────────────

function PieceCard({ piece, onEdit, onRemove, onRetry }: {
  piece: Piece
  onEdit: () => void
  onRemove: () => void
  onRetry: () => void
}) {
  const THUMB_W = 160
  const scale   = THUMB_W / piece.w
  const THUMB_H = Math.round(piece.h * scale)

  const thumbRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    if (!thumbRef.current || !piece.html) return
    const doc = thumbRef.current.contentDocument
    if (doc) { doc.open(); doc.write(piece.html); doc.close() }
  }, [piece.html])

  return (
    <div className={`relative group rounded-2xl overflow-hidden border-2 bg-white transition-all ${
      piece.status === 'ready'      ? 'border-gray-200 hover:border-blue-400 hover:shadow-lg cursor-pointer' :
      piece.status === 'converting' ? 'border-blue-300 animate-pulse' :
      piece.status === 'error'      ? 'border-red-300' : 'border-gray-200'
    }`}>

      {/* Thumbnail */}
      <div onClick={piece.status === 'ready' ? onEdit : undefined}
        style={{ width: THUMB_W, height: THUMB_H }} className="bg-gray-100 overflow-hidden relative">
        {piece.html ? (
          <iframe ref={thumbRef} title={piece.filename} scrolling="no"
            style={{ width: piece.w, height: piece.h, transform: `scale(${scale})`, transformOrigin: 'top left', border: 'none', pointerEvents: 'none' }} />
        ) : (
          <img src={piece.base64} alt="" className="w-full h-full object-cover" />
        )}

        {/* Overlay status */}
        {piece.status === 'converting' && (
          <div className="absolute inset-0 bg-blue-900 bg-opacity-60 flex flex-col items-center justify-center gap-2">
            <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" style={{ borderWidth: 3 }} />
            <p className="text-white text-xs font-medium">Analizando…</p>
          </div>
        )}
        {piece.status === 'pending' && (
          <div className="absolute inset-0 bg-gray-900 bg-opacity-40 flex items-center justify-center">
            <p className="text-white text-xs font-medium bg-black bg-opacity-50 px-2 py-1 rounded">En cola</p>
          </div>
        )}
        {piece.status === 'error' && (
          <div className="absolute inset-0 bg-red-900 bg-opacity-60 flex flex-col items-center justify-center gap-2 p-2">
            <p className="text-white text-xs text-center">Error</p>
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
        {piece.status === 'ready' && piece.fields.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {piece.fields.slice(0, 3).map((f) => (
              <span key={f.id} className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 px-1.5 py-0.5 rounded truncate max-w-full">
                {f.label.split(' ').slice(1).join(' ')}: {f.value.slice(0, 12)}…
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Remove button */}
      <button onClick={onRemove}
        className="absolute top-1.5 right-1.5 w-5 h-5 bg-black bg-opacity-50 text-white text-xs rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        ×
      </button>
    </div>
  )
}

// ─── Full-screen editor ───────────────────────────────────────────────────────

function PieceEditor({ piece, onClose, onHtmlChange, onExport }: {
  piece: Piece
  onClose: () => void
  onHtmlChange: (html: string) => void
  onExport: (piece: Piece) => void
}) {
  const [html,      setHtml]      = useState(piece.html)
  const [liveHtml,  setLiveHtml]  = useState(piece.html)
  const [fields,    setFields]    = useState<DetectedField[]>(piece.fields)
  const [tab,       setTab]       = useState<'fields' | 'html'>('fields')
  const [split,     setSplit]     = useState(42)
  const [dragging,  setDragging]  = useState(false)
  const iframeRef   = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)

  // Debounce preview
  useEffect(() => { const t = setTimeout(() => setLiveHtml(html), 300); return () => clearTimeout(t) }, [html])
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc && liveHtml) { doc.open(); doc.write(liveHtml); doc.close() }
  }, [liveHtml])

  // Resizable divider
  useEffect(() => {
    if (!dragging) return
    const mv = (e: MouseEvent) => {
      const r = containerRef.current?.getBoundingClientRect()
      if (!r) return
      setSplit(Math.max(24, Math.min(72, ((e.clientX - r.left) / r.width) * 100)))
    }
    const up = () => setDragging(false)
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [dragging])

  function updateField(id: string, val: string) {
    const next = applyFieldChange(html, id, val)
    setHtml(next)
    onHtmlChange(next)
    setFields((prev) => prev.map((f) => f.id === id ? { ...f, value: val } : f))
  }

  function updateHtml(next: string) {
    setHtml(next)
    onHtmlChange(next)
    setFields(extractFields(next))
  }

  const scale = Math.min(1, 520 / piece.w, 700 / piece.h)
  const TAB   = (t: string) => `px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-white">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 font-medium">
          ← Volver
        </button>
        <span className="text-gray-200">|</span>
        <div>
          <span className="font-bold text-gray-900 text-sm">{piece.filename}.{piece.ext}</span>
          <span className="text-xs text-gray-400 ml-2">{piece.w}×{piece.h}px</span>
        </div>
        <div className="flex gap-2 ml-4">
          <button onClick={() => setTab('fields')} className={TAB('fields')}>🎯 Campos detectados</button>
          <button onClick={() => setTab('html')}   className={TAB('html')}>⌨️ HTML</button>
        </div>
        <div className="flex-1" />
        <button onClick={() => onExport({ ...piece, html })}
          className="px-5 py-2 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 flex items-center gap-2">
          ↓ Exportar {piece.ext.toUpperCase()}
        </button>
      </div>

      {/* Body */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left pane: fields or HTML */}
        <div className="flex flex-col overflow-hidden" style={{ width: `${split}%` }}>

          {tab === 'fields' && (
            <>
              <div className="flex-shrink-0 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <p className="text-xs font-semibold text-gray-500">CAMPOS DETECTADOS AUTOMÁTICAMENTE</p>
                <p className="text-xs text-gray-400 mt-0.5">Edita el valor y el preview se actualiza en tiempo real</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {fields.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <p className="text-3xl mb-2">🔍</p>
                    <p className="text-sm">No se detectaron campos con IDs conocidos</p>
                    <p className="text-xs mt-1">Cambia al tab HTML para editar directamente</p>
                  </div>
                ) : fields.map((f) => (
                  <div key={f.id} className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-600">{f.label}</label>
                    <input
                      value={f.value}
                      onChange={(e) => updateField(f.id, e.target.value)}
                      className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                        f.id === 'precio' ? 'border-yellow-300 bg-yellow-50 font-bold text-yellow-900' :
                        f.id === 'smmlv'  ? 'border-yellow-200 bg-yellow-50 text-yellow-800' :
                        'border-gray-200 bg-white text-gray-800'
                      }`}
                    />
                  </div>
                ))}

                {/* Batch replace helper */}
                {fields.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 mb-3">REEMPLAZO RÁPIDO</p>
                    <div className="space-y-2">
                      {fields.filter((f) => ['precio','smmlv'].includes(f.id)).map((f) => (
                        <div key={f.id} className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-16 flex-shrink-0">{f.id}</span>
                          <input placeholder={`Nuevo ${f.id}`}
                            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-400"
                            onKeyDown={(e) => { if (e.key === 'Enter') updateField(f.id, (e.target as HTMLInputElement).value) }} />
                          <span className="text-xs text-gray-300">↵ para aplicar</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'html' && (
            <>
              <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-700">
                <span className="text-xs font-mono font-semibold text-gray-400">HTML</span>
                <span className="text-xs text-gray-500">{html.split('\n').length} líneas</span>
              </div>
              <textarea
                ref={textareaRef}
                value={html}
                onChange={(e) => updateHtml(e.target.value)}
                spellCheck={false}
                className="flex-1 p-4 font-mono text-xs bg-gray-950 text-green-300 resize-none focus:outline-none leading-5"
                style={{ tabSize: 2 }}
              />
            </>
          )}
        </div>

        {/* Divider */}
        <div onMouseDown={() => setDragging(true)}
          className={`flex-shrink-0 w-1.5 cursor-col-resize transition-colors ${dragging ? 'bg-blue-500' : 'bg-gray-200 hover:bg-blue-400'}`} />

        {/* Preview */}
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EditorClient() {
  const [pieces,    setPieces]    = useState<Piece[]>([])
  const [editing,   setEditing]   = useState<Piece | null>(null)
  const [dragOver,  setDragOver]  = useState(false)
  const fileRef     = useRef<HTMLInputElement>(null)
  const zipRef      = useRef<HTMLInputElement>(null)
  const { toasts, add, rm } = useToast()
  const queueRef    = useRef<string[]>([])   // UIDs pending conversion
  const processingRef = useRef(false)

  // ── Process queue ──────────────────────────────────────────────────────────

  const processNext = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0) return
    processingRef.current = true
    const uid = queueRef.current.shift()!

    setPieces((prev) => prev.map((p) => p.uid === uid ? { ...p, status: 'converting' } : p))

    try {
      const piece = await new Promise<Piece>((res) => {
        setPieces((prev) => { const p = prev.find((x) => x.uid === uid); if (p) res(p); return prev })
      })

      const resp = await fetch('/api/image-editor/to-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: piece.base64, width: piece.w, height: piece.h }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Error')

      const fields = extractFields(data.html)
      setPieces((prev) => prev.map((p) =>
        p.uid === uid ? { ...p, status: 'ready', html: data.html, fields } : p
      ))
      add('ok', `✓ ${piece.filename} convertida`)
    } catch (err) {
      setPieces((prev) => prev.map((p) =>
        p.uid === uid ? { ...p, status: 'error', error: String(err) } : p
      ))
      add('err', `Error en imagen: ${String(err).slice(0, 80)}`)
    } finally {
      processingRef.current = false
      setTimeout(processNext, 500)
    }
  }, [add])

  function enqueue(uid: string) {
    queueRef.current.push(uid)
    processNext()
  }

  // ── Add images ──────────────────────────────────────────────────────────────

  async function addImages(files: File[]) {
    const imgFiles = files.filter((f) => f.type.startsWith('image/'))
    if (imgFiles.length === 0) { add('err', 'No se encontraron imágenes'); return }

    const newPieces: Piece[] = []
    for (const f of imgFiles) {
      if (f.size > 12 * 1024 * 1024) { add('err', `${f.name} supera 12MB, se omite`); continue }
      const base64 = await fileToB64(f)
      const { w, h } = await getDims(base64)
      const parts = f.name.split('.')
      const ext   = parts.pop()?.toLowerCase() ?? 'jpg'
      newPieces.push({ uid: uid(), filename: parts.join('.'), ext, mimeType: f.type, base64, w, h, status: 'pending', html: '', fields: [] })
    }

    if (newPieces.length === 0) return
    setPieces((prev) => [...prev, ...newPieces])
    add('info', `${newPieces.length} imagen${newPieces.length > 1 ? 'es' : ''} añadida${newPieces.length > 1 ? 's' : ''}`)
    newPieces.forEach((p) => enqueue(p.uid))
  }

  async function addZip(file: File) {
    const tid = add('info', `Extrayendo imágenes de ${file.name}…`, 0)
    try {
      const { default: JSZip } = await import('jszip')
      const zip   = new JSZip()
      const loaded = await zip.loadAsync(file)
      const imgFiles: { name: string; data: Uint8Array; mime: string }[] = []

      for (const [name, entry] of Object.entries(loaded.files)) {
        if (entry.dir) continue
        if (!/\.(jpe?g|png|webp)$/i.test(name)) continue
        const data = await entry.async('uint8array')
        const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg'
        imgFiles.push({ name: name.split('/').pop() ?? name, data, mime })
      }

      rm(tid)
      if (imgFiles.length === 0) { add('err', 'No se encontraron imágenes en el ZIP'); return }

      const newPieces: Piece[] = []
      for (const { name, data, mime } of imgFiles) {
        const blob   = new Blob([data.buffer as ArrayBuffer], { type: mime })
        const base64 = await fileToB64(blob, mime)
        const { w, h } = await getDims(base64)
        const parts  = name.split('.')
        const ext    = parts.pop()?.toLowerCase() ?? 'jpg'
        newPieces.push({ uid: uid(), filename: parts.join('.'), ext, mimeType: mime, base64, w, h, status: 'pending', html: '', fields: [] })
      }

      setPieces((prev) => [...prev, ...newPieces])
      add('ok', `${newPieces.length} imágenes extraídas del ZIP`)
      newPieces.forEach((p) => enqueue(p.uid))
    } catch (err) {
      rm(tid); add('err', 'Error leyendo ZIP: ' + String(err))
    }
  }

  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    const zips = arr.filter((f) => f.type === 'application/zip' || f.name.endsWith('.zip'))
    const imgs = arr.filter((f) => f.type.startsWith('image/'))
    zips.forEach(addZip)
    if (imgs.length) addImages(imgs)
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  async function exportPiece(p: Piece) {
    const tid = add('info', `Exportando ${p.filename}…`, 0)
    try {
      const format = p.ext === 'png' ? 'png' : 'jpeg'
      const res = await fetch('/api/price-pieces/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: p.html, width: p.w, height: p.h, filename: `${p.filename}.${p.ext}`, format }),
      })
      rm(tid)
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      const blob = await res.blob()
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${p.filename}.${p.ext}` })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      add('ok', `✓ ${p.filename}.${p.ext} exportado`)
    } catch (err) { rm(tid); add('err', String(err)) }
  }

  async function exportAll() {
    const ready = pieces.filter((p) => p.status === 'ready' && p.html)
    if (ready.length === 0) { add('err', 'No hay imágenes listas para exportar'); return }
    add('info', `Exportando ${ready.length} imágenes…`, 0)
    for (const p of ready) { await exportPiece(p); await new Promise((r) => setTimeout(r, 400)) }
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  const ready      = pieces.filter((p) => p.status === 'ready').length
  const converting = pieces.filter((p) => p.status === 'converting').length
  const pending    = pieces.filter((p) => p.status === 'pending').length
  const errors     = pieces.filter((p) => p.status === 'error').length

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ══ Header ═══════════════════════════════════════════════════════════ */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">Editor Imagen → HTML → Imagen</h1>
          <p className="text-xs text-gray-400 leading-none mt-0.5">Sube imágenes o un ZIP · IA convierte a HTML · edita campos · exporta en formato original</p>
        </div>

        {pieces.length > 0 && (
          <div className="flex items-center gap-3 ml-4">
            {ready      > 0 && <span className="text-xs bg-green-100 text-green-700 font-semibold px-2.5 py-1 rounded-full">✓ {ready} listas</span>}
            {converting > 0 && <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2.5 py-1 rounded-full animate-pulse">⚙ {converting} convirtiendo</span>}
            {pending    > 0 && <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2.5 py-1 rounded-full">⏳ {pending} en cola</span>}
            {errors     > 0 && <span className="text-xs bg-red-100 text-red-700 font-semibold px-2.5 py-1 rounded-full">✗ {errors} errores</span>}
          </div>
        )}

        <div className="flex-1" />

        <div className="flex gap-2">
          <button onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 flex items-center gap-1.5">
            🖼 Agregar imágenes
          </button>
          <button onClick={() => zipRef.current?.click()}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 flex items-center gap-1.5">
            📦 Cargar ZIP
          </button>
          {ready > 0 && (
            <button onClick={exportAll}
              className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 flex items-center gap-1.5">
              ↓ Exportar todas ({ready})
            </button>
          )}
          {pieces.length > 0 && (
            <button onClick={() => setPieces([])} className="px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl hover:bg-gray-200">
              Limpiar
            </button>
          )}
        </div>

        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />
        <input ref={zipRef} type="file" accept=".zip,application/zip" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) addZip(f); e.target.value = '' }} />
      </header>

      {/* ══ Main area ════════════════════════════════════════════════════════ */}
      <main className="flex-1 min-h-0 overflow-auto p-5">

        {pieces.length === 0 ? (
          /* ── Empty state / Upload zone ── */
          <div className="h-full flex items-center justify-center min-h-80">
            <div
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              className={`w-full max-w-2xl rounded-3xl border-2 border-dashed p-16 text-center cursor-pointer transition-all ${
                dragOver ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}
            >
              <div className="text-6xl mb-5">📤</div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Arrastra imágenes o un ZIP aquí</h2>
              <p className="text-gray-400 text-sm mb-6">JPG · PNG · WEBP · o un archivo .ZIP con múltiples imágenes</p>
              <div className="flex gap-4 justify-center">
                <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
                  className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 text-sm">
                  Seleccionar imágenes
                </button>
                <button onClick={(e) => { e.stopPropagation(); zipRef.current?.click() }}
                  className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 text-sm">
                  Cargar ZIP
                </button>
              </div>
              <div className="mt-8 grid grid-cols-3 gap-4 text-left max-w-lg mx-auto">
                {[
                  { icon: '✨', t: 'IA analiza', d: 'Gemini detecta precio, SMMLV, nombre y más' },
                  { icon: '✏️', t: 'Edita fácil', d: 'Campos detectados listos para cambiar' },
                  { icon: '📸', t: 'Exporta fiel', d: 'PNG o JPG en el mismo formato y tamaño' },
                ].map((c) => (
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
          /* ── Pieces grid ── */
          <div
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            onDragOver={(e) => e.preventDefault()}
          >
            {/* Progress bar when converting */}
            {(converting + pending) > 0 && (
              <div className="mb-4 bg-white rounded-xl p-3 flex items-center gap-3 border border-blue-100">
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{ width: `${(ready / pieces.length) * 100}%` }} />
                </div>
                <span className="text-xs font-medium text-gray-600 flex-shrink-0">
                  {ready}/{pieces.length} convertidas
                  {converting > 0 && ` · analizando ${converting}…`}
                </span>
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              {pieces.map((p) => (
                <PieceCard
                  key={p.uid}
                  piece={p}
                  onEdit={() => setEditing(p)}
                  onRemove={() => setPieces((prev) => prev.filter((x) => x.uid !== p.uid))}
                  onRetry={() => {
                    setPieces((prev) => prev.map((x) => x.uid === p.uid ? { ...x, status: 'pending' } : x))
                    enqueue(p.uid)
                  }}
                />
              ))}

              {/* Drop-more zone */}
              <div onClick={() => fileRef.current?.click()}
                className="w-40 h-52 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all text-gray-400 hover:text-blue-500">
                <span className="text-3xl">+</span>
                <span className="text-xs font-medium">Agregar más</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ══ Full editor ═══════════════════════════════════════════════════════ */}
      {editing && (
        <PieceEditor
          piece={editing}
          onClose={() => setEditing(null)}
          onHtmlChange={(html) => {
            setPieces((prev) => prev.map((p) => p.uid === editing.uid ? { ...p, html, fields: extractFields(html) } : p))
            setEditing((prev) => prev ? { ...prev, html, fields: extractFields(html) } : null)
          }}
          onExport={exportPiece}
        />
      )}

      {/* ══ Toasts ══════════════════════════════════════════════════════════ */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-xs pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} onClick={() => rm(t.id)}
            className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 cursor-pointer ${
              t.type === 'ok' ? 'bg-green-600 text-white' : t.type === 'err' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
            }`}>
            <span>{t.type === 'ok' ? '✓' : t.type === 'err' ? '✗' : '⏳'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
