// Figma MCP client — spawns figma-developer-mcp as a subprocess and calls its tools
// via the Model Context Protocol. Used server-side only (Next.js API routes).
//
// Tools available:
//   get_figma_data      → simplified design tree (AI-readable, relative layout)
//   download_figma_images → writes PNGs to filesystem (not used here; we use REST for that)
//
// For price-detection coordinates we still use the raw Figma REST API because
// figma-developer-mcp returns RELATIVE parent offsets, not absolute canvas bounds.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'path'

// ─── Types (mirror figma-developer-mcp/dist/index.d.ts) ──────────────────────

export interface SimplifiedTextStyle {
  fontFamily?: string
  fontStyle?: string
  fontWeight?: number
  fontSize?: number
  lineHeight?: string
  letterSpacing?: string
  italic?: boolean
  fills?: string
}

export interface SimplifiedLayout {
  mode?: string
  dimensions?: { width?: number; height?: number }
  locationRelativeToParent?: { x: number; y: number }
  position?: 'absolute'
}

export interface SimplifiedNode {
  id: string
  name: string
  type: string
  text?: string                   // content of TEXT nodes
  textStyle?: string              // serialized SimplifiedTextStyle
  layout?: string                 // serialized SimplifiedLayout
  fills?: string
  opacity?: number
  children?: SimplifiedNode[]
}

export interface SimplifiedDesign {
  name: string
  nodes: SimplifiedNode[]         // top-level pages (CANVAS type)
  components: Record<string, unknown>
  componentSets: Record<string, unknown>
  globalVars: unknown
}

// Price text patterns for identifying relevant nodes in the simplified tree
const PRICE_PATTERNS = [
  /\$[\d.,]+/,
  /\d{1,3}(?:[.,]\d{3})+/,
  /\d+\s*smmlv/i,
  /desde\s*\$/i,
  /\d+\s*m(?:illones)?/i,
  /[₡$€£¥]\s*[\d.,]+/,
]

function isPriceText(text: string): boolean {
  return PRICE_PATTERNS.some((r) => r.test(text))
}

// ─── Subprocess MCP client ────────────────────────────────────────────────────

function getMCPCommand(): { command: string; args: string[] } {
  // Prefer the installed binary to avoid npx cold-start latency
  const binPath = path.resolve(process.cwd(), 'node_modules', '.bin', 'figma-developer-mcp')
  return {
    command: binPath,
    args: ['--stdio', '--format=json', '--no-telemetry'],
  }
}

interface MCPTextContent {
  type: 'text'
  text: string
}

interface MCPToolResult {
  content: (MCPTextContent | { type: string })[]
  isError?: boolean
}

async function callFigmaMCPTool<T>(
  token: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<T> {
  const { command, args } = getMCPCommand()

  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env, FIGMA_API_KEY: token },
  })

  const client = new Client(
    { name: 'amarilo-automation', version: '0.1.0' },
    { capabilities: {} }
  )

  // Wrap in a timeout so we don't hang indefinitely
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Figma MCP timeout after ${timeoutMs}ms`)), timeoutMs)
  )

  const runPromise = (async () => {
    await client.connect(transport)
    try {
      const result = (await client.callTool({
        name: toolName,
        arguments: toolArgs,
      })) as MCPToolResult

      if (result.isError) {
        const errText =
          (result.content as MCPTextContent[]).find((c) => c.type === 'text')?.text ||
          'MCP tool error'
        throw new Error(`Figma MCP error: ${errText}`)
      }

      const textContent = (result.content as MCPTextContent[]).find((c) => c.type === 'text')
      if (!textContent?.text) throw new Error('No text content in Figma MCP response')

      return JSON.parse(textContent.text) as T
    } finally {
      await client.close().catch(() => {}) // best-effort close
    }
  })()

  return Promise.race([runPromise, timeoutPromise])
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call get_figma_data via the Figma MCP server.
 * Returns the simplified design tree (AI-readable, relative coords).
 *
 * @param token  Figma Personal Access Token
 * @param fileKey  Figma file key (extracted from the URL)
 * @param nodeId   Optional specific node ID (e.g. "1234:5678")
 * @param depth    Tree traversal depth (default 6)
 */
export async function figmaMCPGetData(
  token: string,
  fileKey: string,
  nodeId?: string,
  depth = 6
): Promise<SimplifiedDesign> {
  const args: Record<string, unknown> = { fileKey, depth }
  if (nodeId) args.nodeId = nodeId

  return callFigmaMCPTool<SimplifiedDesign>(token, 'get_figma_data', args)
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

/**
 * Walk the simplified design tree and collect all FRAME/COMPONENT nodes,
 * attaching their parent page name and whether they contain price-like text.
 */
export interface MCPFrameSummary {
  id: string
  name: string
  pageName: string
  hasPriceHints: boolean       // at least one TEXT child matched a price pattern
  priceHintTexts: string[]     // the matched price strings
  dimensions?: { width?: number; height?: number }
}

export function extractFrameSummaries(design: SimplifiedDesign): MCPFrameSummary[] {
  const summaries: MCPFrameSummary[] = []

  for (const page of design.nodes) {
    // Top-level nodes are CANVAS (pages)
    if (page.type !== 'CANVAS' || !page.children) continue

    for (const node of page.children) {
      if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
        continue
      }

      const priceTexts = collectPriceTexts(node)
      let dims: { width?: number; height?: number } | undefined
      if (node.layout) {
        try {
          const layout = JSON.parse(node.layout) as SimplifiedLayout
          dims = layout.dimensions
        } catch {}
      }

      summaries.push({
        id: node.id,
        name: node.name,
        pageName: page.name,
        hasPriceHints: priceTexts.length > 0,
        priceHintTexts: priceTexts,
        dimensions: dims,
      })
    }
  }

  return summaries
}

function collectPriceTexts(node: SimplifiedNode): string[] {
  const found: string[] = []
  if (node.type === 'TEXT' && node.text && isPriceText(node.text)) {
    found.push(node.text)
  }
  if (node.children) {
    for (const child of node.children) {
      found.push(...collectPriceTexts(child))
    }
  }
  return found
}

/**
 * Parse textStyle JSON string returned by figma-developer-mcp.
 * Returns safe defaults on failure.
 */
export function parseMCPTextStyle(textStyle?: string): SimplifiedTextStyle {
  if (!textStyle) return {}
  try { return JSON.parse(textStyle) as SimplifiedTextStyle } catch { return {} }
}

/**
 * Parse layout JSON string returned by figma-developer-mcp.
 */
export function parseMCPLayout(layout?: string): SimplifiedLayout {
  if (!layout) return {}
  try { return JSON.parse(layout) as SimplifiedLayout } catch { return {} }
}
