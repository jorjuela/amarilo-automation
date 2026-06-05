'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'converting' | 'editor'
type Toast = { id: number; type: 'ok' | 'err' | 'info'; msg: string }

interface ImageInfo {
  base64: string
  w: number
  h: number
  name: string
  size: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload  = (e) => res(e.target!.result as string)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

async function getSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const img = new Image()
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => res({ w: 540, h: 960 })
    img.src = src
  })
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n/1024).toFixed(0)} KB`
  return `${(n/1048576).toFixed(1)} MB`
}

// ─── Toast system ─────────────────────────────────────────────────────────────

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  let counter = useRef(0)

  const add = useCallback((type: Toast['type'], msg: string, duration = 4000) => {
    const id = ++counter.current
    setToasts((p) => [...p, { id, type, msg }])
    if (duration > 0) setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), duration)
    return id
  }, [])

  const remove = useCallback((id: number) => setToasts((p) => p.filter((t) => t.id !== id)), [])

  return { toasts, add, remove }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EditorImagenClient() {
  const [step,       setStep]       = useState<Step>('upload')
  const [img,        setImg]        = useState<ImageInfo | null>(null)
  const [html,       setHtml]       = useState('')
  const [liveHtml,   setLiveHtml]   = useState('')
  const [split,      setSplit]      = useState(48)           // % left pane
  const [dragging,   setDragging]   = useState(false)        // divider drag
  const [hovering,   setHovering]   = useState(false)        // drop zone
  const [exporting,  setExporting]  = useState(false)
  const [converting, setConverting] = useState(false)
  const [qPrice,     setQPrice]     = useState('')
  const [qSmmlv,     setQSmmlv]     = useState('')
  const { toasts, add, remove } = useToasts()

  const fileRef     = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const iframeRef   = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounce HTML → preview
  useEffect(() => {
    const t = setTimeout(() => setLiveHtml(html), 300)
    return () => clearTimeout(t)
  }, [html])

  // Write to iframe
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (doc && liveHtml) { doc.open(); doc.write(liveHtml); doc.close() }
  }, [liveHtml])

  // Resizable divider
  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setSplit(Math.max(20, Math.min(78, ((e.clientX - r.left) / r.width) * 100)))
    }
    const up = () => setDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging])

  // ── Load image ──────────────────────────────────────────────────────────────

  async function loadFile(file: File) {
    if (!file.type.startsWith('image/')) { add('err', 'Solo imágenes (JPG, PNG, WEBP)'); return }
    if (file.size > 10 * 1024 * 1024) { add('err', 'Imagen demasiado grande. Máximo 10 MB.'); return }
    try {
      const base64 = await fileToBase64(file)
      const { w, h } = await getSize(base64)
      setImg({ base64, w, h, name: file.name.replace(/\.[^.]+$/, ''), size: fmtBytes(file.size) })
      setHtml('')
      setLiveHtml('')
      setStep('upload')
      add('ok', `${file.name} cargada · ${w}×${h}px`)
    } catch { add('err', 'Error leyendo el archivo') }
  }

  // ── Convert with Gemini Vision ───────────────────────────────────────────────

  async function convert() {
    if (!img) return
    setStep('converting')
    setConverting(true)
    const tid = add('info', 'Analizando con Gemini Vision… puede tardar hasta 30 s', 0)
    try {
      const res = await fetch('/api/image-editor/to-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: img.base64, width: img.w, height: img.h }),
      })
      const data = await res.json()
      remove(tid)
      if (!res.ok) throw new Error(data.error || 'Error del servidor')
      setHtml(data.html)
      setStep('editor')
      add('ok', 'HTML generado. Edita el código o los textos del preview.')
    } catch (err) {
      remove(tid)
      add('err', String(err))
      setStep('upload')
    } finally { setConverting(false) }
  }

  // ── Quick replace ────────────────────────────────────────────────────────────

  function applyReplace() {
    let h = html
    if (qPrice) h = h.replace(/(<[^>]+id="precio"[^>]*>)([\s\S]*?)(<\/\w+>)/, `$1${qPrice}$3`)
    if (qSmmlv) h = h.replace(/(<[^>]+id="smmlv"[^>]*>)([\s\S]*?)(<\/\w+>)/, `$1${qSmmlv}$3`)
    if (h !== html) { setHtml(h); add('ok', 'Precio actualizado') }
    else add('err', 'No se encontró id="precio" o id="smmlv" en el HTML')
  }

  // ── Insert snippet ────────────────────────────────────────────────────────────

  function insert(code: string) {
    const ta = textareaRef.current
    if (!ta) return
    const s = ta.selectionStart
    setHtml(html.slice(0, s) + '\n' + code + '\n' + html.slice(ta.selectionEnd))
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + code.length + 2; ta.focus() })
  }

  const H = img?.h ?? 960
  const W = img?.w ?? 540

  const SNIPPETS = [
    { label: '$ Precio',         code: `<div id="precio" contenteditable="true" style="position:absolute;left:50%;top:72%;transform:translate(-50%,-50%);font-size:${Math.round(H*.044)}px;font-weight:900;color:#FABD02;font-family:Montserrat,Arial,sans-serif;text-shadow:0 2px 8px rgba(0,0,0,.5);white-space:nowrap;text-align:center;">$293.500.000</div>` },
    { label: '% SMMLV',          code: `<div id="smmlv"  contenteditable="true" style="position:absolute;left:50%;top:78%;transform:translate(-50%,-50%);font-size:${Math.round(H*.019)}px;font-weight:700;color:#FABD02;font-family:Montserrat,Arial,sans-serif;white-space:nowrap;text-align:center;">135 SMMLV + Parqueadero</div>` },
    { label: '🏗 Nombre',        code: `<div id="nombre" contenteditable="true" style="position:absolute;left:50%;top:62%;transform:translate(-50%,-50%);font-size:${Math.round(H*.034)}px;font-weight:900;color:#fff;font-family:Montserrat,Arial,sans-serif;text-transform:uppercase;text-align:center;text-shadow:0 2px 10px rgba(0,0,0,.6);">NOMBRE PROYECTO</div>` },
    { label: '💬 Tagline',       code: `<div id="tagline" contenteditable="true" style="position:absolute;left:50%;top:56%;transform:translate(-50%,-50%);font-size:${Math.round(H*.017)}px;color:rgba(255,255,255,.9);font-family:Montserrat,Arial,sans-serif;text-align:center;">Tu mejor inversión</div>` },
    { label: '🏷 Badge',         code: `<div id="badge" contenteditable="true" style="position:absolute;left:50%;top:13%;transform:translate(-50%,-50%);background:#FABD02;color:#1B3D6B;font-size:${Math.round(H*.014)}px;font-weight:800;padding:6px 22px;border-radius:20px;letter-spacing:1px;white-space:nowrap;">MUY PRONTO</div>` },
    { label: '📝 Disclaimer',    code: `<div id="disclaimer" contenteditable="true" style="position:absolute;bottom:1.2%;left:3%;right:3%;font-size:${Math.round(H*.0088)}px;color:rgba(255,255,255,.5);font-family:Montserrat,Arial,sans-serif;line-height:1.4;text-align:center;">*Imagen de referencia. Sujeto a modificaciones.</div>` },
  ]

  // ── Export PNG via Playwright ─────────────────────────────────────────────────

  async function exportPng() {
    if (!html.trim()) { add('err', 'El editor está vacío'); return }
    setExporting(true)
    const tid = add('info', 'Renderizando con Playwright en el servidor…', 0)
    try {
      const res = await fetch('/api/price-pieces/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, width: W, height: H, filename: `${img?.name ?? 'pieza'}.png` }),
      })
      remove(tid)
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      const blob = await res.blob()
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `${img?.name ?? 'pieza'}.png`,
      })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      add('ok', '¡PNG descargado!')
    } catch (err) { remove(tid); add('err', String(err)) }
    finally { setExporting(false) }
  }

  // ── Preview scale ─────────────────────────────────────────────────────────────
  const scale = Math.min(1, 500 / W, 600 / H)

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-white select-none">

      {/* ══ Top bar ═══════════════════════════════════════════════════════════ */}
      <header className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-white z-10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">🖼</span>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-gray-900 leading-none">Editor de Imágenes</h1>
            <p className="text-xs text-gray-400 leading-none mt-0.5">Imagen → HTML (IA) → PNG</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 ml-3">
          {([['1','Subir','upload'],['2','Convertir','converting'],['3','Editar','editor']] as const).map(([n, label, s]) => (
            <div key={n} className="flex items-center gap-1">
              <div className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${step === s || (step === 'editor' && s !== 'upload') || (step === 'converting' && s === 'upload') ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>{n}</div>
              <span className={`text-xs hidden sm:inline ${step === s ? 'text-blue-700 font-semibold' : 'text-gray-400'}`}>{label}</span>
              {n !== '3' && <span className="text-gray-200 text-xs mx-1">›</span>}
            </div>
          ))}
        </div>

        {img && (
          <span className="text-xs text-gray-400 border border-gray-200 rounded px-2 py-0.5">
            {img.name} · {img.w}×{img.h} · {img.size}
          </span>
        )}

        <div className="flex-1" />

        {/* Toolbar actions — only in editor step */}
        {step === 'editor' && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Quick price */}
            <input value={qPrice} onChange={(e) => setQPrice(e.target.value)}
              placeholder="#precio nuevo"
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs w-32 focus:outline-none focus:border-yellow-400" />
            <input value={qSmmlv} onChange={(e) => setQSmmlv(e.target.value)}
              placeholder="#smmlv"
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs w-24 focus:outline-none focus:border-yellow-400" />
            <button onClick={applyReplace} disabled={!qPrice && !qSmmlv}
              className="px-3 py-1.5 bg-yellow-500 text-white text-xs font-bold rounded-lg hover:bg-yellow-600 disabled:opacity-40">
              Cambiar
            </button>

            <div className="w-px h-4 bg-gray-200" />

            {/* Snippets */}
            <div className="relative group">
              <button className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200">+ Insertar ▾</button>
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1.5 min-w-48 hidden group-hover:block">
                {SNIPPETS.map((s) => (
                  <button key={s.label} onClick={() => insert(s.code)}
                    className="flex items-center gap-2 w-full px-4 py-2 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700">
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-px h-4 bg-gray-200" />

            <button onClick={convert} disabled={converting}
              className="px-3 py-1.5 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
              {converting ? <span className="animate-spin text-sm">⚙</span> : '✨'} Re-generar
            </button>

            <button onClick={exportPng} disabled={exporting}
              className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
              {exporting ? '⏳' : '↓'} Exportar PNG
            </button>
          </div>
        )}
      </header>

      {/* ══ Body ══════════════════════════════════════════════════════════════ */}
      <main className="flex-1 min-h-0 relative overflow-hidden">

        {/* ── UPLOAD screen ── */}
        {(step === 'upload' || step === 'converting') && (
          <div className="h-full flex items-center justify-center p-6">
            <div className="w-full max-w-2xl space-y-6">

              {/* Drop zone */}
              <div
                onClick={() => fileRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); setHovering(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f) }}
                onDragOver={(e) => { e.preventDefault(); setHovering(true) }}
                onDragLeave={() => setHovering(false)}
                className={`relative rounded-2xl border-2 border-dashed p-12 text-center cursor-pointer transition-all ${hovering ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
              >
                {img ? (
                  <div className="flex items-center gap-6 justify-center">
                    <img src={img.base64} alt="" className="w-20 h-auto rounded-xl shadow-md object-cover" style={{ maxHeight: 120 }} />
                    <div className="text-left">
                      <p className="font-bold text-gray-800 text-lg">{img.name}</p>
                      <p className="text-sm text-gray-500">{img.w} × {img.h} px · {img.size}</p>
                      <p className="text-xs text-gray-400 mt-1">Haz clic para cambiar la imagen</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-5xl mb-3">📤</div>
                    <p className="font-semibold text-gray-700 text-lg">Arrastra la imagen aquí</p>
                    <p className="text-sm text-gray-400 mt-1">o haz clic para seleccionar · JPG · PNG · WEBP · máx 10 MB</p>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f) }} />

              {/* Convert button */}
              {img && (
                <button onClick={convert} disabled={converting}
                  className="w-full py-4 bg-purple-600 text-white font-bold text-base rounded-2xl hover:bg-purple-700 disabled:opacity-60 flex items-center justify-center gap-3 transition-all shadow-lg shadow-purple-200">
                  {converting ? (
                    <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Analizando con Gemini Vision…</>
                  ) : (
                    <><span className="text-2xl">✨</span>Convertir a HTML editable con IA</>
                  )}
                </button>
              )}

              {/* How it works */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: '✨', t: 'IA analiza la imagen', d: 'Gemini Vision identifica todos los textos, posiciones, colores y estilos' },
                  { icon: '✏️', t: 'HTML totalmente editable', d: 'Precio, SMMLV, nombre y más con contenteditable directo en el preview' },
                  { icon: '📸', t: 'Exporta PNG fiel', d: 'Playwright renderiza el HTML en el servidor y genera un PNG de alta calidad' },
                ].map((c) => (
                  <div key={c.t} className="bg-gray-50 rounded-xl p-4">
                    <div className="text-2xl mb-2">{c.icon}</div>
                    <p className="text-xs font-bold text-gray-700">{c.t}</p>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{c.d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── EDITOR screen ── */}
        {step === 'editor' && (
          <div ref={containerRef} className="h-full flex overflow-hidden">

            {/* Code pane */}
            <div className="flex flex-col overflow-hidden" style={{ width: `${split}%` }}>
              <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-700">
                <span className="text-xs font-mono font-semibold text-gray-400">HTML</span>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>{html.split('\n').length} líneas · {(html.length / 1024).toFixed(1)} KB</span>
                  <button onClick={() => setHtml('')} className="text-red-400 hover:text-red-300">Limpiar</button>
                </div>
              </div>
              <textarea
                ref={textareaRef}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                className="flex-1 p-4 font-mono text-xs bg-gray-950 text-green-300 resize-none focus:outline-none leading-5 overflow-auto"
                style={{ tabSize: 2 }}
              />
            </div>

            {/* Divider */}
            <div
              onMouseDown={() => setDragging(true)}
              className={`flex-shrink-0 w-1.5 cursor-col-resize transition-colors ${dragging ? 'bg-blue-500' : 'bg-gray-200 hover:bg-blue-400'}`}
            />

            {/* Preview pane */}
            <div className="flex flex-col flex-1 overflow-hidden bg-gray-100">
              <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200">
                <span className="text-xs font-semibold text-gray-500">PREVIEW EN VIVO</span>
                <span className="text-xs text-gray-400">Los textos marcados son editables (clic directo)</span>
              </div>
              <div className="flex-1 overflow-auto flex items-start justify-center pt-8 pb-6 px-6">
                <div style={{ width: Math.round(W * scale), height: Math.round(H * scale), flexShrink: 0 }}
                  className="rounded-xl overflow-hidden shadow-2xl">
                  <iframe
                    ref={iframeRef}
                    title="preview"
                    style={{ width: W, height: H, border: 'none', display: 'block', transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'auto' }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ══ Toast notifications ═══════════════════════════════════════════════ */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div key={t.id} onClick={() => remove(t.id)}
            className={`flex items-start gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium cursor-pointer transition-all ${
              t.type === 'ok'   ? 'bg-green-600 text-white' :
              t.type === 'err'  ? 'bg-red-600   text-white' :
                                   'bg-blue-600  text-white'
            }`}>
            <span>{t.type === 'ok' ? '✓' : t.type === 'err' ? '✗' : '⏳'}</span>
            <span className="flex-1">{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
