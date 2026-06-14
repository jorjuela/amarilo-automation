// Figma node tree → self-contained HTML/CSS for Playwright rendering.
//
// Strategy: reconstruct every layer as a position:absolute div so no image
// erasure is needed. The price TEXT node is replaced in-place with the new value.
// All other layers (images, shapes, text) are rendered pixel-accurately.
//
// Limitations (accepted trade-offs):
//   - Commercial fonts (Gotham, Galano Grotesque, etc.) fall back to system sans-serif.
//     All non-price text is already baked into the frame export, so only the
//     price replacement is affected.
//   - Complex vector paths / SVG nodes are skipped (rendered as transparent placeholders).
//   - blend modes are not replicated in CSS (ignored).

import type { FigmaNode, FigmaFill, FigmaColor, FigmaBounds, FigmaGradientStop } from './client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HtmlRenderOptions {
  priceLayerName: string    // e.g. 'precio'
  newPrice: string
  imageMap: Record<string, string>   // imageRef → CDN URL (from /v1/files/KEY/images)
  base64ImageMap?: Record<string, string> // imageRef → data URI (optional pre-proxied)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function buildFrameHtml(
  frameNode: FigmaNode,
  opts: HtmlRenderOptions,
): string {
  const bounds = frameNode.absoluteBoundingBox ?? { x: 0, y: 0, width: 540, height: 960 }
  const { width, height } = bounds

  // Build the root layer
  const inner = renderChildren(frameNode.children ?? [], bounds.x, bounds.y, opts)

  // Background fill of the frame itself
  const frameBgCss = buildFillCss(frameNode.fills ?? [], opts)
  const frameBorderRadiusCss = frameNode.cornerRadius ? `border-radius:${frameNode.cornerRadius}px;` : ''

  // No external resources (no Google Fonts) so Playwright can render with
  // waitUntil:'domcontentloaded' — all images are embedded as base64 data URIs.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:${width}px;height:${height}px;overflow:hidden;background:transparent;}
.root{position:relative;width:${width}px;height:${height}px;overflow:hidden;${frameBgCss}${frameBorderRadiusCss}}
</style>
</head>
<body>
<div class="root">
${inner}
</div>
</body>
</html>`
}

// ─── Recursive rendering ──────────────────────────────────────────────────────

function renderChildren(
  children: FigmaNode[],
  parentAbsX: number,
  parentAbsY: number,
  opts: HtmlRenderOptions,
): string {
  return children
    .filter((n) => n.visible !== false)
    .map((n) => renderNode(n, parentAbsX, parentAbsY, opts))
    .join('\n')
}

function renderNode(
  node: FigmaNode,
  parentAbsX: number,
  parentAbsY: number,
  opts: HtmlRenderOptions,
): string {
  if (node.visible === false) return ''

  const bounds = node.absoluteBoundingBox
  if (!bounds) return ''

  const localX = Math.round(bounds.x - parentAbsX)
  const localY = Math.round(bounds.y - parentAbsY)
  const w = Math.round(bounds.width)
  const h = Math.round(bounds.height)

  const opacity = node.opacity ?? 1
  const cr = buildCornerRadius(node)

  let style =
    `position:absolute;left:${localX}px;top:${localY}px;width:${w}px;height:${h}px;`
  if (opacity < 0.999) style += `opacity:${opacity.toFixed(3)};`
  if (cr) style += cr

  const blendMode = node.blendMode
  if (blendMode && blendMode !== 'NORMAL' && blendMode !== 'PASS_THROUGH') {
    style += `mix-blend-mode:${blendModeToCss(blendMode)};`
  }

  if (node.type === 'TEXT') {
    return renderText(node, style, bounds, opts)
  }

  if (node.type === 'ELLIPSE') {
    style += 'border-radius:50%;'
  }

  // Fill + stroke
  if (node.fills?.length) style += buildFillCss(node.fills, opts)
  if (node.strokes?.length && node.strokeWeight) {
    style += buildStrokeCss(node.strokes, node.strokeWeight, node.strokeAlign)
  }

  // Effects: drop shadow
  const shadowCss = buildShadowCss(node.effects ?? [])
  if (shadowCss) style += shadowCss

  // Frame-type nodes clip their children
  const isClip = node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.clipsContent
  if (isClip) style += 'overflow:hidden;'

  const inner = node.children?.length
    ? renderChildren(node.children, bounds.x, bounds.y, opts)
    : ''

  return `<div style="${style}">${inner}</div>`
}

// ─── Text node ────────────────────────────────────────────────────────────────

function renderText(
  node: FigmaNode,
  baseStyle: string,
  _bounds: FigmaBounds,
  opts: HtmlRenderOptions,
): string {
  const s: import('./client').FigmaTextStyle = node.style ?? {
    fontFamily: 'Inter', fontWeight: 400, fontSize: 16,
  }
  const isPrice = isPriceLayer(node.name, opts.priceLayerName)
  const text = isPrice ? opts.newPrice : (node.characters || '')

  // Text color from fills
  const textFill = node.fills?.find(
    (f) => f.type === 'SOLID' && f.color && f.visible !== false,
  )
  const color = textFill?.color ? colorToCss(textFill.color) : '#000000'

  let style = baseStyle
  style += `color:${color};`
  style += `font-family:'${s.fontFamily || 'Inter'}',sans-serif;`
  style += `font-size:${s.fontSize ?? 16}px;`
  style += `font-weight:${s.fontWeight ?? 400};`
  if (s.italic) style += 'font-style:italic;'

  const align = ALIGN_MAP[s.textAlignHorizontal ?? 'LEFT'] ?? 'left'
  style += `text-align:${align};`

  if (s.lineHeightPx && s.lineHeightPx > 0) style += `line-height:${s.lineHeightPx}px;`
  if (s.letterSpacing) style += `letter-spacing:${s.letterSpacing}px;`

  const textTransform = TEXT_CASE_MAP[s.textCase ?? '']
  if (textTransform) style += `text-transform:${textTransform};`

  const textDecoration = TEXT_DECO_MAP[s.textDecoration ?? '']
  if (textDecoration) style += `text-decoration:${textDecoration};`

  style += 'white-space:pre-wrap;word-break:break-word;overflow:hidden;'

  return `<div style="${style}">${escHtml(text)}</div>`
}

// ─── Fill → CSS ───────────────────────────────────────────────────────────────

function buildFillCss(fills: FigmaFill[], opts: HtmlRenderOptions): string {
  const visible = fills.filter((f) => f.visible !== false)
  if (!visible.length) return ''

  // Figma renders fills top-to-bottom (index 0 = top).
  // CSS background-image layers are also top-to-bottom.
  // background-color is always the bottom-most layer.

  const bgImages: string[] = []
  const bgSizes: string[] = []
  const bgPositions: string[] = []
  const bgRepeats: string[] = []
  let bgColor = ''

  for (const fill of visible) {
    if (fill.type === 'SOLID' && fill.color) {
      const alpha = fill.opacity ?? 1
      const css = colorToCss(fill.color, alpha)
      // Solid fills above the first one are rendered as solid-gradient layers
      if (!bgColor) {
        bgColor = css
      } else {
        bgImages.push(`linear-gradient(${css},${css})`)
        bgSizes.push('100% 100%')
        bgPositions.push('0 0')
        bgRepeats.push('no-repeat')
      }
    } else if (
      (fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_ANGULAR') &&
      fill.gradientStops
    ) {
      const angle = computeLinearAngle(fill.gradientHandlePositions)
      const stops = stopsToCSS(fill.gradientStops, fill.opacity)
      bgImages.push(`linear-gradient(${angle}deg,${stops})`)
      bgSizes.push('100% 100%')
      bgPositions.push('0 0')
      bgRepeats.push('no-repeat')
    } else if (fill.type === 'GRADIENT_RADIAL' && fill.gradientStops) {
      const stops = stopsToCSS(fill.gradientStops, fill.opacity)
      bgImages.push(`radial-gradient(ellipse at center,${stops})`)
      bgSizes.push('100% 100%')
      bgPositions.push('0 0')
      bgRepeats.push('no-repeat')
    } else if (fill.type === 'IMAGE' && fill.imageRef) {
      const url =
        opts.base64ImageMap?.[fill.imageRef] ??
        opts.imageMap[fill.imageRef] ??
        ''
      if (url) {
        bgImages.push(`url("${url}")`)
        const scaleMode = fill.scaleMode ?? 'FILL'
        bgSizes.push(scaleMode === 'FIT' ? 'contain' : scaleMode === 'TILE' ? 'auto' : 'cover')
        bgPositions.push('center')
        bgRepeats.push(scaleMode === 'TILE' ? 'repeat' : 'no-repeat')
      }
    }
  }

  let css = ''
  if (bgColor) css += `background-color:${bgColor};`
  if (bgImages.length) {
    css += `background-image:${bgImages.join(',')};`
    css += `background-size:${bgSizes.join(',')};`
    css += `background-position:${bgPositions.join(',')};`
    css += `background-repeat:${bgRepeats.join(',')};`
  }
  return css
}

// ─── Stroke → CSS ─────────────────────────────────────────────────────────────

function buildStrokeCss(strokes: FigmaFill[], weight: number, align?: string): string {
  const s = strokes.find((f) => f.type === 'SOLID' && f.color && f.visible !== false)
  if (!s?.color) return ''
  const col = colorToCss(s.color)
  // INSIDE: inset box-shadow; OUTSIDE: outline; CENTER: border
  if (align === 'INSIDE') return `box-shadow:inset 0 0 0 ${weight}px ${col};`
  if (align === 'OUTSIDE') return `outline:${weight}px solid ${col};outline-offset:0;`
  return `border:${weight}px solid ${col};`
}

// ─── Shadow → CSS ─────────────────────────────────────────────────────────────

function buildShadowCss(effects: { type: string; visible?: boolean; radius?: number; color?: FigmaColor; offset?: { x: number; y: number }; spread?: number }[]): string {
  const shadows = effects.filter(
    (e) => e.type === 'DROP_SHADOW' && e.visible !== false && e.color,
  )
  if (!shadows.length) return ''
  const parts = shadows.map((e) => {
    const x = e.offset?.x ?? 0
    const y = e.offset?.y ?? 0
    const blur = e.radius ?? 0
    const spread = e.spread ?? 0
    const col = e.color ? colorToCss(e.color) : 'rgba(0,0,0,0.25)'
    return `${x}px ${y}px ${blur}px ${spread}px ${col}`
  })
  return `box-shadow:${parts.join(',')};`
}

// ─── Corner radius ────────────────────────────────────────────────────────────

function buildCornerRadius(node: FigmaNode): string {
  if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii
    if (tl === tr && tr === br && br === bl) {
      return tl > 0 ? `border-radius:${tl}px;` : ''
    }
    return `border-radius:${tl}px ${tr}px ${br}px ${bl}px;`
  }
  if (node.cornerRadius && node.cornerRadius > 0) {
    return `border-radius:${node.cornerRadius}px;`
  }
  return ''
}

// ─── Gradient helpers ─────────────────────────────────────────────────────────

function computeLinearAngle(handles?: Array<{ x: number; y: number }>): number {
  if (!handles || handles.length < 2) return 90
  const [p0, p1] = handles
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const rad = Math.atan2(dy, dx)
  return Math.round((rad * 180) / Math.PI) + 90
}

function stopsToCSS(stops: FigmaGradientStop[], opacity = 1): string {
  return stops
    .map((s) => {
      const col = colorToCss(s.color, opacity)
      return `${col} ${Math.round(s.position * 100)}%`
    })
    .join(',')
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const BLEND_MODE_MAP: Record<string, string> = {
  MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay',
  DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge',
  COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue',
  SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
}

function blendModeToCss(mode: string): string {
  return BLEND_MODE_MAP[mode] ?? 'normal'
}

function colorToCss(c: FigmaColor, extraOpacity = 1): string {
  const r = Math.round(c.r * 255)
  const g = Math.round(c.g * 255)
  const b = Math.round(c.b * 255)
  const a = +(c.a * extraOpacity).toFixed(3)
  return `rgba(${r},${g},${b},${a})`
}

function isPriceLayer(name: string, configuredName: string): boolean {
  const n = name.trim().toLowerCase()
  const c = configuredName.trim().toLowerCase()
  return n === c || n.startsWith(c + ' ') || n.endsWith(' ' + c) || n === c
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const ALIGN_MAP: Record<string, string> = {
  LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify',
}

const TEXT_CASE_MAP: Record<string, string> = {
  UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize',
}

const TEXT_DECO_MAP: Record<string, string> = {
  UNDERLINE: 'underline', STRIKETHROUGH: 'line-through',
}
