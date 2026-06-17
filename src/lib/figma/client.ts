// Figma REST API client (read-only, uses Personal Access Token)

const FIGMA_BASE = 'https://api.figma.com/v1'

export interface FigmaColor {
  r: number; g: number; b: number; a: number
}

export interface FigmaGradientStop {
  color: FigmaColor
  position: number
}

export interface FigmaEffect {
  type: string   // DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR
  visible?: boolean
  radius?: number
  color?: FigmaColor
  offset?: { x: number; y: number }
  spread?: number
}

export interface FigmaFill {
  type: string   // SOLID | GRADIENT_LINEAR | GRADIENT_RADIAL | IMAGE | GRADIENT_ANGULAR
  visible?: boolean
  opacity?: number
  blendMode?: string
  color?: FigmaColor
  // Gradient
  gradientHandlePositions?: Array<{ x: number; y: number }>
  gradientStops?: FigmaGradientStop[]
  // Image
  imageRef?: string
  scaleMode?: string   // FILL | FIT | CROP | TILE
}

export interface FigmaTextStyle {
  fontFamily: string
  fontPostScriptName?: string
  fontWeight: number
  fontSize: number
  italic?: boolean
  letterSpacing?: number
  lineHeightPx?: number
  textAlignHorizontal?: string
  // Figma typography extras
  textCase?: string         // UPPER | LOWER | TITLE | ORIGINAL | SMALL_CAPS
  textDecoration?: string   // UNDERLINE | STRIKETHROUGH | NONE
  lineHeightUnit?: string   // PIXELS | FONT_SIZE_%
  letterSpacingUnit?: string // PIXELS | PERCENT
  fills?: FigmaFill[]       // node-level fills (text color)
  opacity?: number          // node opacity (0-1)
}

export interface FigmaBounds {
  x: number; y: number; width: number; height: number
}

export interface FigmaNode {
  id: string
  name: string
  type: string
  children?: FigmaNode[]
  absoluteBoundingBox?: FigmaBounds
  characters?: string           // TEXT nodes only
  style?: FigmaTextStyle        // TEXT nodes only
  fills?: FigmaFill[]
  strokes?: FigmaFill[]
  strokeWeight?: number
  strokeAlign?: string          // INSIDE | OUTSIDE | CENTER
  visible?: boolean
  opacity?: number
  cornerRadius?: number
  rectangleCornerRadii?: [number, number, number, number]
  clipsContent?: boolean        // FRAME nodes
  effects?: FigmaEffect[]
  blendMode?: string
}

export interface FigmaPage {
  id: string
  name: string
  type: 'CANVAS'
  children: FigmaNode[]
}

export interface FigmaFile {
  name: string
  lastModified: string
  thumbnailUrl?: string
  document: {
    id: string
    name: string
    type: 'DOCUMENT'
    children: FigmaPage[]
  }
}

export interface BackgroundNode {
  id: string
  name: string
  bounds: FigmaBounds
}

export interface DetectedFrame {
  id: string
  name: string
  bounds: FigmaBounds
  priceNodes: PriceNode[]
  backgroundNode?: BackgroundNode
  pageId: string
  pageName: string
}

// Full visual data of the rectangle that sits directly behind the price TEXT node.
// Carrying bounds + visual properties lets the erase rectangle match the container
// exactly (same position, size, corner radius, opacity, blend mode).
export interface PriceContainer {
  color: FigmaColor
  bounds: FigmaBounds        // absolute canvas coords (same system as node.absoluteBoundingBox)
  cornerRadius?: number
  opacity?: number           // 0-1; undefined means 1
  blendMode?: string         // Figma blend mode string, e.g. 'MULTIPLY'
}

export interface PriceNode {
  id: string
  name: string
  text: string
  bounds: FigmaBounds
  style: FigmaTextStyle
  color: FigmaColor
  // Backward-compat: fill color only (kept so existing callers don't break)
  containerColor?: FigmaColor
  // Full container info — use this for accurate erase rectangles
  container?: PriceContainer
}

// ─── Parse Figma file URL → file key ─────────────────────────────────────────

export function parseFigmaUrl(url: string): string | null {
  // Handles:
  // https://www.figma.com/file/FILEKEY/Title?...
  // https://www.figma.com/design/FILEKEY/Title?...
  const m = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/)
  return m ? m[1] : null
}

// ─── Price layer detection ────────────────────────────────────────────────────
// Primary: layer named "precio" (or variants) — explicit Figma convention.
// Fallback: TEXT content matching price number patterns.

const PRICE_LAYER_NAMES = new Set([
  // Spanish
  'precio', 'valor', 'tarifa', 'costo', 'monto', 'importe',
  'precio base', 'precio final', 'precio desde', 'desde precio',
  'cuota', 'cuota mensual', 'cuotas', 'mensualidad',
  // English
  'price', 'amount', 'value', 'cost', 'fee', 'rate', 'total',
  'monthly', 'plan price', 'subscription', 'plan cost',
  // Portuguese
  'preço', 'valor', 'mensalidade',
  // Generic / design convention
  'key value', 'featured value', 'main value', 'hero value',
  'number', 'numero', 'figure',
])

function isPriceLayerName(name: string, configuredName = 'precio'): boolean {
  const n = name.trim().toLowerCase()
  const c = configuredName.trim().toLowerCase()
  return PRICE_LAYER_NAMES.has(n) || n === c || n.startsWith(c) || n.endsWith(c)
}

function findBackgroundNode(
  node: FigmaNode,
  layerName: string,
  depth = 0,
): BackgroundNode | undefined {
  if (depth > 6) return undefined
  const n = (node.name || '').trim().toLowerCase()
  const target = layerName.trim().toLowerCase()
  if (n === target && node.absoluteBoundingBox) {
    return { id: node.id, name: node.name, bounds: node.absoluteBoundingBox }
  }
  if (node.children) {
    for (const child of node.children) {
      const found = findBackgroundNode(child, layerName, depth + 1)
      if (found) return found
    }
  }
  return undefined
}

const PRICE_PATTERNS = [
  // Any currency symbol prefix  ($, €, £, ¥, ₹, ₽, ₩, ₿, etc.)
  /^[$€£¥₹₽₩₪₿₴₦₫฿₵₡₢₤₧₨₭₮₰₱₲₳₸₺₼₾]\s*[\d.,]+/,
  // Number + ISO currency code or crypto ticker
  /^[\d.,]+\s*(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|CNY|BRL|COP|MXN|ARS|CLP|PEN|CRC|HNL|GTQ|PAB|DOP|BOB|UYU|VES|BTC|ETH|USDT|BNB|SOL|XRP|USDC|DAI|ADA|DOGE|AVAX|MATIC)\b/i,
  // Currency code + number
  /^(?:USD|EUR|GBP|CAD|AUD|BTC|ETH|USDT)\s*[\d.,]+/i,
  // Spanish real-estate / LATAM
  /^[\d.,]+\s*(?:millones?|M)\b/i,
  /^\d[\d.,]*\s*SMMLV\b/i,
  /^[\d.,]+\s*(?:mil|K)\b/i,
  /desde\s*[$€£¥]?[\d.,]+/i,
  // "desde / from / à partir" prefix patterns
  /^(?:from|desde|dès|ab|da|van)\s+[$€£¥₹]?[\d.,]+/i,
  // Large formatted number (e.g. 1,200,000 or 1.200.000 or 600,555,0000)
  // Must have at least one separator group and be 6+ total chars to avoid short codes.
  /^\d{1,3}(?:[.,]\d{3,4})+$/,
]

function looksLikePrice(text: string): boolean {
  const t = text.trim()
  if (t.length === 0 || t.length > 80) return false
  return PRICE_PATTERNS.some((p) => p.test(t))
}

// ─── Walk node tree for price nodes ──────────────────────────────────────────
// Matches TEXT nodes by layer name first, then by text content as fallback.
// Also enters GROUP/FRAME nodes whose layer name matches "precio" to capture
// compound price components (e.g. a group named "precio" containing text).

// Returns the first SOLID fill color found in a node's fills array, or undefined.
function solidFill(node: FigmaNode): FigmaColor | undefined {
  return node.fills?.find((f) => f.type === 'SOLID' && f.color)?.color
}

// Build a PriceContainer from a node that acts as the visual background of the price.
function makeContainer(node: FigmaNode): PriceContainer | undefined {
  const color = solidFill(node)
  const bounds = node.absoluteBoundingBox
  if (!color || !bounds) return undefined
  return {
    color,
    bounds,
    cornerRadius: node.cornerRadius,
    opacity: node.opacity,
    blendMode: node.blendMode,
  }
}

// Returns true only if the node's bounding box covers less than 60 % of the
// frame area — rules out full-frame background rectangles that should never
// be used as a price-specific container fill.
function isSizedForPriceContainer(node: FigmaNode, frameBounds: FigmaBounds): boolean {
  const rb = node.absoluteBoundingBox
  if (!rb) return true
  const frameArea = frameBounds.width * frameBounds.height
  if (frameArea <= 0) return true
  return (rb.width * rb.height) / frameArea < 0.6
}

// Walks the entire node tree searching for TEXT nodes whose layer name matches
// the configured price layer name (or variants), or whose text content looks
// like a price.
//
// nearestContainer: the closest ancestor/sibling container node found so far.
// Priority: RECTANGLE/VECTOR sibling of the TEXT's parent > parent fill > inherited.
function walkForPriceNodes(
  node: FigmaNode,
  frameBounds: FigmaBounds,
  configuredPriceLayerName = 'precio',
  nearestContainer?: PriceContainer,
): PriceNode[] {
  const results: PriceNode[] = []

  if (node.type === 'TEXT') {
    const byName = isPriceLayerName(node.name || '', configuredPriceLayerName)
    const byContent = node.characters ? looksLikePrice(node.characters) : false

    if (byName || byContent) {
      const bounds = node.absoluteBoundingBox || { x: 0, y: 0, width: 100, height: 20 }
      const fill = node.fills?.find((f) => f.type === 'SOLID' && f.color)
      results.push({
        id: node.id,
        name: node.name,
        text: node.characters || '',
        bounds,
        style: node.style || { fontFamily: 'Inter', fontWeight: 700, fontSize: 24 },
        color: fill?.color || { r: 1, g: 1, b: 1, a: 1 },
        containerColor: nearestContainer?.color,
        container: nearestContainer,
      })
    }
  }

  // Recurse into children, passing the best container found at this level.
  if (node.children) {
    // Prefer a RECTANGLE/VECTOR sibling that is small enough to be a dedicated
    // price background (not a full-frame background rect).
    const bgRect = node.children.find(
      (c) =>
        (c.type === 'RECTANGLE' || c.type === 'VECTOR') &&
        solidFill(c) &&
        isSizedForPriceContainer(c, frameBounds),
    )

    // FRAME/COMPONENT/INSTANCE fills are the creative's own background —
    // never use them as the price container; inherit the previous one instead.
    const isLayoutFrame =
      node.type === 'FRAME' ||
      node.type === 'COMPONENT' ||
      node.type === 'INSTANCE'

    const childContainer = bgRect
      ? makeContainer(bgRect)
      : (isLayoutFrame ? nearestContainer : (makeContainer(node) ?? nearestContainer))

    for (const child of node.children) {
      results.push(...walkForPriceNodes(child, frameBounds, configuredPriceLayerName, childContainer))
    }
  }

  return results
}

// ─── Build DetectedFrames list from Figma file ────────────────────────────────

export interface LayerNameOpts {
  priceLayerName?: string
  backgroundLayerName?: string
}

export function extractFramesFromFile(file: FigmaFile, opts?: LayerNameOpts): DetectedFrame[] {
  const frames: DetectedFrame[] = []

  for (const page of file.document.children) {
    collectTopLevelFrames(page.children, page, frames, 0, opts)
  }

  return frames
}

// Walk one level of nodes. Enters SECTION/GROUP to find nested frames
// but does NOT recurse into FRAME children (those are design elements, not pieces).
function collectTopLevelFrames(
  nodes: FigmaNode[],
  page: FigmaPage,
  out: DetectedFrame[],
  sectionDepth = 0,
  opts?: LayerNameOpts,
) {
  if (sectionDepth > 4) return // safety guard against deeply nested groups

  const priceName = opts?.priceLayerName || 'precio'
  const bgName = opts?.backgroundLayerName || 'background'

  for (const node of nodes) {
    if (node.visible === false) continue

    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      const bounds = node.absoluteBoundingBox || { x: 0, y: 0, width: 540, height: 960 }
      out.push({
        id: node.id,
        name: node.name,
        bounds,
        priceNodes: walkForPriceNodes(node, bounds, priceName),
        backgroundNode: node.children ? findBackgroundNode(node, bgName) : undefined,
        pageId: page.id,
        pageName: page.name,
      })
    } else if (
      (node.type === 'SECTION' || node.type === 'GROUP' || node.type === 'COMPONENT_SET') &&
      node.children?.length
    ) {
      // Sections/groups are containers — recurse to find the actual frames inside
      collectTopLevelFrames(node.children, page, out, sectionDepth + 1, opts)
    }
  }
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function figmaFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${FIGMA_BASE}${path}`, {
    headers: { 'X-Figma-Token': token },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Figma API ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export async function getFigmaFile(token: string, fileKey: string): Promise<FigmaFile> {
  // depth=6: doc→page→section→frame→children→text — needed for files with Sections
  return figmaFetch<FigmaFile>(token, `/files/${fileKey}?depth=6`)
}

// Returns all image fills used in the file: { imageRef → CDN URL }
// CDN URLs are signed S3 links valid for ~24 h.
export async function getFileImages(token: string, fileKey: string): Promise<Record<string, string>> {
  try {
    const data = await figmaFetch<{ meta?: { images?: Record<string, string> } }>(
      token,
      `/files/${fileKey}/images`,
    )
    return data.meta?.images ?? {}
  } catch {
    return {}
  }
}

export async function exportFigmaFrames(
  token: string,
  fileKey: string,
  nodeIds: string[],
  scale = 2,
): Promise<Record<string, string>> {
  // Returns a map of nodeId → image URL (hosted on Figma's CDN, expires after ~30min)
  const ids = nodeIds.join(',')
  const data = await figmaFetch<{ images: Record<string, string> }>(
    token,
    `/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=${scale}`,
  )
  return data.images
}

// ─── Convert Figma color (0-1) → CSS rgba ─────────────────────────────────────

export function figmaColorToCss(c: FigmaColor): string {
  const r = Math.round(c.r * 255)
  const g = Math.round(c.g * 255)
  const b = Math.round(c.b * 255)
  return `rgba(${r},${g},${b},${c.a})`
}
