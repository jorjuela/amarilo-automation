'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = (e) => resolve(e.target?.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function getImageDimensions(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 540, h: 960 })
    img.src = src
  })
}

// ─── Status bar ───────────────────────────────────────────────────────────────

type StatusType = 'idle' | 'loading' | 'success' | 'error'
interface Status { type: StatusType; msg: string }

const STATUS_COLORS: Record<StatusType, string> = {
  idle:    'bg-gray-50 text-gray-500 border-gray-200',
  loading: 'bg-blue-50  text-blue-700  border-blue-200',
  success: 'bg-green-50 text-green-700 border-green-200',
  error:   'bg-red-50   text-red-700   border-red-200',
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ImageEditorClient() {
  // ── State ──
  const [imageB64,  setImageB64]  = useState<string | null>(null)
  const [imgSize,   setImgSize]   = useState({ w: 540, h: 960 })
  const [imgName,   setImgName]   = useState('')
  const [html,      setHtml]      = useState('')
  const [preview,   setPreview]   = useState('')
  const [status,    setStatus]    = useState<Status>({ type: 'idle', msg: 'Sube una imagen para comenzar' })
  const [step,      setStep]      = useState<1 | 2 | 3>(1)
  const [splitW,    setSplitW]    = useState(50)       // % for code pane
  const [isDragging, setIsDragging] = useState(false)

  // Quick-replace fields
  const [qPrice,  setQPrice]  = useState('')
  const [qSmmlv,  setQSmmlv]  = useState('')

  const dropRef      = useRef<HTMLDivElement>(null)
  const fileRef      = useRef<HTMLInputElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const iframeRef    = useRef<HTMLIFrameElement>(null)
  const dividerRef   = useRef<HTMLDivElement>(null)

  // ── Debounced preview sync ──
  useEffect(() => {
    const t = setTimeout(() => setPreview(html), 350)
    return () => clearTimeout(t)
  }, [html])

  useEffect(() => {
    if (!iframeRef.current || !preview) return
    const doc = iframeRef.current.contentDocument
    if (doc) { doc.open(); doc.write(preview); doc.close() }
  }, [preview])

  // ── Drag-to-resize split pane ──
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      const container = dividerRef.current?.parentElement
      if (!container) return
      const rect = container.getBoundingClientRect()
      const pct  = Math.max(20, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100))
      setSplitW(pct)
    }
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [isDragging])

  function setMsg(type: StatusType, msg: string) {
    setStatus({ type, msg })
  }

  // ── Load image ──
  async function loadImage(file: File) {
    if (!file.type.startsWith('image/')) { setMsg('error', 'Solo se aceptan archivos de imagen (JPG, PNG, WEBP)'); return }
    try {
      const b64 = await readFileAsBase64(file)
      const dim = await getImageDimensions(b64)
      setImageB64(b64)
      setImgSize(dim)
      setImgName(file.name.replace(/\.[^.]+$/, ''))
      setHtml('')
      setPreview('')
      setStep(2)
      setMsg('success', `Imagen cargada: ${dim.w}×${dim.h}px — haz clic en "Convertir a HTML"`)
    } catch { setMsg('error', 'No se pudo leer la imagen') }
  }

  // Drag & drop
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) loadImage(f)
  }

  // ── Convert with Gemini ──
  async function convertToHtml() {
    if (!imageB64) return
    setStep(3)
    setMsg('loading', 'Analizando imagen con Gemini Vision… esto puede tardar 15–30 segundos')
    try {
      const res = await fetch('/api/image-editor/to-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageB64, width: imgSize.w, height: imgSize.h }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al convertir')
      setHtml(data.html)
      setMsg('success', 'HTML generado. Edita el código o haz clic en los textos del preview para modificarlos.')
    } catch (err) {
      setMsg('error', String(err))
      setStep(2)
    }
  }

  // ── Quick price replacement ──
  function applyQuickReplace() {
    if (!qPrice && !qSmmlv) return
    let updated = html
    if (qPrice) updated = updated.replace(/(<[^>]+id="precio"[^>]*>)([\s\S]*?)(<\/\w+>)/, `$1${qPrice}$3`)
    if (qSmmlv) updated = updated.replace(/(<[^>]+id="smmlv"[^>]*>)([\s\S]*?)(<\/\w+>)/, `$1${qSmmlv}$3`)
    setHtml(updated)
    setMsg('success', 'Texto actualizado en el HTML.')
  }

  // ── Insert snippet at cursor ──
  function insertSnippet(snippet: string) {
    const ta = textareaRef.current
    if (!ta) return
    const s = ta.selectionStart, e = ta.selectionEnd
    const next = html.slice(0, s) + snippet + html.slice(e)
    setHtml(next)
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + snippet.length; ta.focus() })
  }

  // ── Export via Playwright ──
  const [exporting, setExporting] = useState(false)
  async function exportPng() {
    if (!html.trim()) { setMsg('error', 'El editor está vacío'); return }
    setExporting(true)
    setMsg('loading', 'Renderizando con Playwright en el servidor…')
    try {
      const res = await fetch('/api/price-pieces/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, width: imgSize.w, height: imgSize.h, filename: `${imgName || 'pieza'}.png` }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error del servidor') }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `${imgName || 'pieza'}.png`
      document.body.appendChild(a); a.click()
      document.body.removeChild(a); URL.revokeObjectURL(url)
      setMsg('success', 'PNG exportado correctamente.')
    } catch (err) { setMsg('error', String(err)) }
    finally { setExporting(false) }
  }

  // ── Scale for preview ──
  const previewScale = Math.min(1, (window?.innerHeight ?? 800) * 0.65 / imgSize.h, 480 / imgSize.w)

  // ── Snippets ──
  const SNIPPETS = [
    { label: 'Precio editable',   code: `<div id="precio" contenteditable="true" style="position:absolute;top:70%;left:50%;transform:translateX(-50%);font-size:${Math.round(imgSize.h*0.045)}px;font-weight:900;color:#FABD02;font-family:'Montserrat',Arial,sans-serif;text-align:center;white-space:nowrap;">$293.500.000</div>` },
    { label: 'SMMLV',             code: `<div id="smmlv"  contenteditable="true" style="position:absolute;top:77%;left:50%;transform:translateX(-50%);font-size:${Math.round(imgSize.h*0.02)}px;font-weight:700;color:#FABD02;font-family:'Montserrat',Arial,sans-serif;text-align:center;">135 SMMLV + Parqueadero</div>` },
    { label: 'Nombre proyecto',   code: `<div id="nombre" contenteditable="true" style="position:absolute;top:60%;left:50%;transform:translateX(-50%);font-size:${Math.round(imgSize.h*0.035)}px;font-weight:900;color:#FFFFFF;font-family:'Montserrat',Arial,sans-serif;text-align:center;text-transform:uppercase;">NOMBRE DEL PROYECTO</div>` },
    { label: 'Tagline',           code: `<div id="tagline" contenteditable="true" style="position:absolute;top:55%;left:50%;transform:translateX(-50%);font-size:${Math.round(imgSize.h*0.018)}px;color:rgba(255,255,255,0.9);font-family:'Montserrat',Arial,sans-serif;text-align:center;">Tu mejor inversión</div>` },
    { label: 'Badge MUY PRONTO',  code: `<div id="badge" contenteditable="true" style="position:absolute;top:12%;left:50%;transform:translateX(-50%);background:#FABD02;color:#1B3D6B;font-size:${Math.round(imgSize.h*0.015)}px;font-weight:800;padding:6px 20px;border-radius:20px;letter-spacing:1px;white-space:nowrap;">MUY PRONTO</div>` },
    { label: 'Disclaimer pie',    code: `<div id="disclaimer" contenteditable="true" style="position:absolute;bottom:1.5%;left:3%;right:3%;font-size:${Math.round(imgSize.h*0.009)}px;color:rgba(255,255,255,0.55);font-family:'Montserrat',Arial,sans-serif;line-height:1.4;text-align:center;">*Imagen de referencia. Sujeto a modificaciones.</div>` },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ═══ STEP 1: Upload (shown when no image) ════════════════════════════ */}
      {step === 1 && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl space-y-6 text-center">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Convertir imagen a HTML editable</h2>
              <p className="text-gray-500 text-sm">Sube cualquier pieza publicitaria. La IA la convierte a HTML con todos los textos editables, y puedes exportarla de vuelta a imagen de alta calidad.</p>
            </div>

            {/* Drop zone */}
            <div
              ref={dropRef}
              onClick={() => fileRef.current?.click()}
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-blue-300 rounded-2xl p-12 cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all group"
            >
              <p className="text-5xl mb-4 group-hover:scale-110 transition-transform">🖼</p>
              <p className="font-semibold text-gray-700">Arrastra la imagen aquí</p>
              <p className="text-sm text-gray-400 mt-1">o haz clic para seleccionar</p>
              <p className="text-xs text-gray-300 mt-3">JPG · PNG · WEBP</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImage(f) }} />

            {/* How it works */}
            <div className="grid grid-cols-3 gap-4 text-left">
              {[
                { n:'1', icon:'🖼', t:'Sube la imagen', d:'JPG, PNG o WEBP de tu pieza publicitaria' },
                { n:'2', icon:'✨', t:'IA convierte a HTML', d:'Gemini analiza cada elemento y genera HTML/CSS fiel' },
                { n:'3', icon:'✏️', t:'Edita y exporta', d:'Modifica textos, exporta PNG con Playwright' },
              ].map((s) => (
                <div key={s.n} className="bg-gray-50 rounded-xl p-4">
                  <div className="text-2xl mb-2">{s.icon}</div>
                  <p className="text-xs font-bold text-gray-700">{s.t}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ STEP 2: Image loaded, ready to convert ══════════════════════════ */}
      {step === 2 && imageB64 && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-2xl space-y-6">
            <div className="flex items-start gap-6">
              {/* Thumbnail */}
              <div className="flex-shrink-0 rounded-xl overflow-hidden border border-gray-200 shadow-md" style={{ width: 160, height: Math.round(160 * imgSize.h / imgSize.w) }}>
                <img src={imageB64} alt="" className="w-full h-full object-cover" />
              </div>
              {/* Info + action */}
              <div className="flex-1 space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Imagen cargada ✓</h2>
                  <p className="text-sm text-gray-500 mt-1">{imgName} · {imgSize.w}×{imgSize.h}px</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
                  <p className="font-semibold mb-1">¿Qué hará Gemini?</p>
                  <ul className="space-y-1 text-xs">
                    <li>• Identifica todos los textos y los hace editables</li>
                    <li>• Mantiene la imagen original como fondo (máxima fidelidad)</li>
                    <li>• Asigna IDs a precio, SMMLV, nombre, tagline, disclaimer</li>
                    <li>• Recrea formas y colores CSS puros donde sea posible</li>
                  </ul>
                </div>
                <div className="flex gap-3">
                  <button onClick={convertToHtml}
                    className="flex-1 py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 flex items-center justify-center gap-2 text-sm">
                    ✨ Convertir a HTML con IA
                  </button>
                  <button onClick={() => { setStep(1); setImageB64(null) }}
                    className="px-4 py-3 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 text-sm">
                    Cambiar imagen
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ STEP 3: Editor ══════════════════════════════════════════════════ */}
      {step === 3 && (
        <>
          {/* ── Toolbar ── */}
          <div className="flex-shrink-0 bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2 flex-wrap">

            {/* Back / reset */}
            <button onClick={() => { setStep(imageB64 ? 2 : 1); setHtml('') }}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
              ← Atrás
            </button>

            <div className="w-px h-5 bg-gray-200" />

            {/* Re-generate */}
            <button onClick={convertToHtml} disabled={status.type === 'loading'}
              className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50">
              {status.type === 'loading' ? <span className="animate-spin">⚙️</span> : '✨'}
              Re-generar HTML
            </button>

            <div className="w-px h-5 bg-gray-200" />

            {/* Quick replace */}
            <div className="flex items-center gap-1.5">
              <input value={qPrice} onChange={(e) => setQPrice(e.target.value)} placeholder="#precio"
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs w-32 focus:outline-none focus:border-blue-400" />
              <input value={qSmmlv} onChange={(e) => setQSmmlv(e.target.value)} placeholder="#smmlv"
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs w-28 focus:outline-none focus:border-blue-400" />
              <button onClick={applyQuickReplace} disabled={!qPrice && !qSmmlv}
                className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-bold rounded-lg disabled:opacity-40">
                Cambiar
              </button>
            </div>

            <div className="w-px h-5 bg-gray-200" />

            {/* Snippets dropdown */}
            <div className="relative group">
              <button className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200">
                + Insertar ▾
              </button>
              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-40 py-1 min-w-44 hidden group-hover:block">
                {SNIPPETS.map((s) => (
                  <button key={s.label} onClick={() => insertSnippet(s.code)}
                    className="block w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
                    + {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1" />

            {/* Image info */}
            {imageB64 && (
              <span className="text-xs text-gray-400">{imgName} · {imgSize.w}×{imgSize.h}px</span>
            )}

            {/* Export */}
            <button onClick={exportPng} disabled={exporting || !html.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-50">
              {exporting ? '⏳ Exportando…' : '↓ Exportar PNG'}
            </button>
          </div>

          {/* ── Status ── */}
          <div className={`flex-shrink-0 px-4 py-1.5 text-xs font-medium border-b ${STATUS_COLORS[status.type]}`}>
            {status.type === 'loading' && <span className="mr-2 animate-pulse">⏳</span>}
            {status.msg}
          </div>

          {/* ── Split pane ── */}
          <div className="flex flex-1 min-h-0 overflow-hidden select-none">

            {/* Code pane */}
            <div className="flex flex-col overflow-hidden" style={{ width: `${splitW}%` }}>
              <div className="flex-shrink-0 px-3 py-1.5 bg-gray-900 text-gray-400 text-xs flex items-center justify-between border-b border-gray-700">
                <span className="font-mono font-semibold">HTML</span>
                <div className="flex gap-3">
                  <span>{html.split('\n').length} líneas</span>
                  {html && <button onClick={() => { setHtml(''); setPreview('') }} className="text-red-400 hover:text-red-300">Limpiar</button>}
                </div>
              </div>
              <textarea
                ref={textareaRef}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                placeholder="El HTML aparecerá aquí tras la conversión…"
                className="flex-1 p-4 font-mono text-xs bg-gray-950 text-green-300 resize-none focus:outline-none leading-5 overflow-auto"
                style={{ tabSize: 2 }}
              />
            </div>

            {/* Draggable divider */}
            <div
              ref={dividerRef}
              onMouseDown={() => setIsDragging(true)}
              className={`flex-shrink-0 w-1.5 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors ${isDragging ? 'bg-blue-500' : ''}`}
            />

            {/* Preview pane */}
            <div className="flex flex-col flex-1 overflow-hidden bg-gray-100">
              <div className="flex-shrink-0 px-3 py-1.5 bg-gray-50 text-gray-500 text-xs border-b border-gray-200 flex items-center justify-between">
                <span className="font-semibold">PREVIEW — los textos son editables (clic directo)</span>
                <span className="text-gray-400">Se actualiza automáticamente</span>
              </div>
              <div className="flex-1 overflow-auto flex items-start justify-center p-6">
                {preview ? (
                  <div style={{
                    width: Math.round(imgSize.w * previewScale),
                    height: Math.round(imgSize.h * previewScale),
                    flexShrink: 0,
                  }}>
                    <iframe
                      ref={iframeRef}
                      title="preview"
                      style={{
                        width: imgSize.w,
                        height: imgSize.h,
                        border: 'none',
                        display: 'block',
                        boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
                        transform: `scale(${previewScale})`,
                        transformOrigin: 'top left',
                      }}
                    />
                  </div>
                ) : (
                  <div className="text-center text-gray-400 mt-24">
                    <p className="text-5xl mb-3">🖥</p>
                    <p className="font-medium text-gray-500">El preview aparecerá aquí</p>
                    {status.type === 'loading' && (
                      <p className="text-sm mt-2 text-blue-500 animate-pulse">Generando HTML con IA…</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Loading overlay for step transition ── */}
      {step === 3 && status.type === 'loading' && !html && (
        <div className="absolute inset-0 bg-white bg-opacity-80 flex items-center justify-center z-50 flex-col gap-4">
          <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600 font-medium text-sm">{status.msg}</p>
          {imageB64 && (
            <img src={imageB64} alt="" className="w-24 h-auto rounded-lg shadow opacity-50 mt-2" />
          )}
        </div>
      )}
    </div>
  )
}
