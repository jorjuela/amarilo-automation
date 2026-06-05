'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  pieceId: string
  pieceName: string
  projectName: string
  imageBase64: string | null
  initialHtml: string | null
  width: number
  height: number
}

const PANEL_WIDTHS = { '50/50': '50%', '40/60': '40%', '60/40': '60%' }

export default function HtmlPieceEditor({ pieceId, pieceName, projectName, imageBase64, initialHtml, width, height }: Props) {
  const [html,         setHtml]         = useState(initialHtml ?? '')
  const [previewHtml,  setPreviewHtml]  = useState(initialHtml ?? '')
  const [generating,   setGenerating]   = useState(false)
  const [exporting,    setExporting]    = useState(false)
  const [layout,       setLayout]       = useState<keyof typeof PANEL_WIDTHS>('50/50')
  const [status,       setStatus]       = useState<{ type: 'success'|'error'|'info'; msg: string } | null>(null)
  const [quickPrice,   setQuickPrice]   = useState('')
  const [quickSmmlv,   setQuickSmmlv]   = useState('')
  const iframeRef  = useRef<HTMLIFrameElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keep preview in sync with a 400ms debounce
  useEffect(() => {
    const t = setTimeout(() => setPreviewHtml(html), 400)
    return () => clearTimeout(t)
  }, [html])

  // Write to iframe
  useEffect(() => {
    if (!iframeRef.current) return
    const doc = iframeRef.current.contentDocument
    if (doc) { doc.open(); doc.write(previewHtml); doc.close() }
  }, [previewHtml])

  function showStatus(type: 'success'|'error'|'info', msg: string) {
    setStatus({ type, msg })
    setTimeout(() => setStatus(null), 4000)
  }

  // ── Generate HTML from image with Gemini Vision ──────────────────────────

  async function generateHtml() {
    if (!imageBase64) { showStatus('error', 'La pieza no tiene imagen. Sube una primero desde el board.'); return }
    setGenerating(true)
    showStatus('info', 'Analizando imagen con Gemini Vision… puede tardar 10-20s')
    try {
      const res = await fetch(`/api/price-pieces/${pieceId}/to-html`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al generar')
      setHtml(data.html)
      setPreviewHtml(data.html)
      showStatus('success', 'HTML generado. Puedes editar el código o hacer clic en los textos del preview.')
    } catch (err) {
      showStatus('error', String(err))
    } finally { setGenerating(false) }
  }

  // ── Quick price replacement ───────────────────────────────────────────────

  function applyQuickPrice() {
    if (!quickPrice && !quickSmmlv) return
    let updated = html

    // Replace content of id="precio"
    if (quickPrice) {
      updated = updated.replace(
        /(<[^>]+id="precio"[^>]*>)([\s\S]*?)(<\/[^>]+>)/,
        `$1${quickPrice}$3`
      )
    }
    // Replace content of id="smmlv"
    if (quickSmmlv) {
      updated = updated.replace(
        /(<[^>]+id="smmlv"[^>]*>)([\s\S]*?)(<\/[^>]+>)/,
        `$1${quickSmmlv}$3`
      )
    }
    setHtml(updated)
    showStatus('success', 'Precio actualizado en el HTML.')
  }

  // ── Export via Playwright (backend) ──────────────────────────────────────

  async function exportPng() {
    if (!html.trim()) { showStatus('error', 'El editor está vacío.'); return }
    setExporting(true)
    showStatus('info', 'Renderizando con Playwright en el servidor…')
    try {
      const res = await fetch('/api/price-pieces/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html,
          width,
          height,
          filename: `${projectName}-${pieceName}.png`.replace(/\s+/g, '-'),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error en el servidor')
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `${projectName}-${pieceName}.png`.replace(/\s+/g, '-')
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showStatus('success', '¡PNG exportado con Playwright!')
    } catch (err) {
      showStatus('error', String(err))
    } finally { setExporting(false) }
  }

  // ── Insert snippet ────────────────────────────────────────────────────────

  function insertAtCursor(snippet: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const next  = html.slice(0, start) + snippet + html.slice(end)
    setHtml(next)
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + snippet.length; ta.focus() }, 0)
  }

  const STATUS_STYLE = { success: 'bg-green-50 border-green-200 text-green-800', error: 'bg-red-50 border-red-200 text-red-700', info: 'bg-blue-50 border-blue-200 text-blue-700' }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Top toolbar ── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        {/* Generate */}
        <button onClick={generateHtml} disabled={generating || !imageBase64}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
          {generating
            ? <><span className="animate-spin">⚙️</span> Analizando…</>
            : <>✨ Generar HTML con IA</>}
        </button>

        <div className="w-px h-6 bg-gray-200" />

        {/* Quick price */}
        <div className="flex items-center gap-2">
          <input value={quickPrice} onChange={(e) => setQuickPrice(e.target.value)} placeholder="Nuevo precio"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:border-blue-400" />
          <input value={quickSmmlv} onChange={(e) => setQuickSmmlv(e.target.value)} placeholder="SMMLV"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:border-blue-400" />
          <button onClick={applyQuickPrice} disabled={!quickPrice && !quickSmmlv}
            className="px-3 py-1.5 bg-yellow-500 text-white text-sm font-semibold rounded-lg hover:bg-yellow-600 disabled:opacity-50">
            Cambiar precio
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200" />

        {/* Layout toggle */}
        <div className="flex gap-1">
          {(Object.keys(PANEL_WIDTHS) as Array<keyof typeof PANEL_WIDTHS>).map((l) => (
            <button key={l} onClick={() => setLayout(l)}
              className={`px-2 py-1 text-xs rounded border ${layout === l ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Snippets */}
        <div className="relative group">
          <button className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
            Insertar snippet ▼
          </button>
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-2 min-w-52 hidden group-hover:block">
            {[
              ['Precio editable',  '<div id="precio" contenteditable="true" style="position:absolute;top:70%;left:50%;transform:translate(-50%,-50%);font-size:36px;font-weight:900;color:#FABD02;font-family:Montserrat,Arial,sans-serif;">$293.500.000</div>'],
              ['SMMLV',            '<div id="smmlv" contenteditable="true" style="position:absolute;top:77%;left:50%;transform:translateX(-50%);font-size:16px;font-weight:700;color:#FABD02;font-family:Montserrat,Arial,sans-serif;">135 SMMLV</div>'],
              ['Nombre proyecto',  '<div id="nombre" contenteditable="true" style="position:absolute;top:60%;left:50%;transform:translateX(-50%);font-size:28px;font-weight:900;color:#FFFFFF;font-family:Montserrat,Arial,sans-serif;">JARDINES DE MANZANILLO</div>'],
              ['Tagline',          '<div id="tagline" contenteditable="true" style="position:absolute;top:55%;left:50%;transform:translateX(-50%);font-size:14px;color:rgba(255,255,255,0.9);font-family:Montserrat,Arial,sans-serif;">Tu mejor inversión</div>'],
            ].map(([label, snippet]) => (
              <button key={label} onClick={() => insertAtCursor(snippet as string)}
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 rounded-lg text-gray-700">
                + {label}
              </button>
            ))}
          </div>
        </div>

        {/* Export */}
        <button onClick={exportPng} disabled={exporting || !html.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">
          {exporting ? '⏳ Exportando…' : '↓ Exportar PNG (Playwright)'}
        </button>
      </div>

      {/* ── Status bar ── */}
      {status && (
        <div className={`flex-shrink-0 px-4 py-2 border-b text-xs font-medium ${STATUS_STYLE[status.type]}`}>
          {status.msg}
        </div>
      )}

      {/* ── Split pane ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Code editor */}
        <div className="flex flex-col border-r border-gray-200 overflow-hidden" style={{ width: PANEL_WIDTHS[layout] }}>
          <div className="flex-shrink-0 px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">HTML EDITOR</span>
            <div className="flex gap-2">
              <span className="text-xs text-gray-400">{html.length} chars</span>
              {html && (
                <button onClick={() => { setHtml(''); setPreviewHtml('') }} className="text-xs text-red-400 hover:text-red-600">Limpiar</button>
              )}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            placeholder={`Haz clic en "✨ Generar HTML con IA" para convertir la imagen\no escribe/pega HTML directamente aquí.\n\nElementos editables en el preview:\n  id="precio"  → precio principal\n  id="smmlv"   → línea SMMLV\n  id="nombre"  → nombre del proyecto`}
            className="flex-1 p-4 font-mono text-xs text-gray-800 bg-gray-950 text-green-400 resize-none focus:outline-none leading-relaxed"
            style={{ tabSize: 2 }}
          />
        </div>

        {/* Preview */}
        <div className="flex flex-col flex-1 overflow-hidden bg-gray-100">
          <div className="flex-shrink-0 px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">PREVIEW EN VIVO</span>
            <span className="text-xs text-gray-400">{width} × {height}px · Haz clic en textos amarillos para editar</span>
          </div>
          <div className="flex-1 overflow-auto flex items-start justify-center p-6">
            {html ? (
              <div style={{ transform: `scale(${Math.min(1, 500/Math.max(width,height))})`, transformOrigin: 'top center' }}>
                <iframe
                  ref={iframeRef}
                  title="preview"
                  style={{ width, height, border: 'none', display: 'block', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
                  sandbox="allow-same-origin"
                />
              </div>
            ) : (
              <div className="text-center text-gray-400 mt-20">
                <p className="text-5xl mb-4">🖥</p>
                <p className="font-medium text-gray-500">El preview aparece aquí</p>
                <p className="text-sm mt-1">Genera el HTML con IA o escríbelo en el editor</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
