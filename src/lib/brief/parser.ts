import type { ParsedBrief, TorreData, ProjectType, Stage, Audience } from '@/types'

// Extract month+year from filename: "FORMATO BRIEF AMARILO PROYECTOS_ABRIL2026- JARDINES DEL RIO.pdf"
export function parseFilename(filename: string): { monthYear: string; projectName: string } {
  const normalized = filename.replace('.pdf', '').replace('.PDF', '')

  // Pattern: _MONTH YEAR- PROJECT NAME
  const match = normalized.match(/_([A-Z]+\d{4})[- ]+(.+)$/i)
  if (match) {
    return {
      monthYear: match[1].toUpperCase(),       // e.g. "ABRIL2026"
      projectName: match[2].trim().toUpperCase(), // e.g. "JARDINES DEL RIO"
    }
  }

  // Fallback: try to find project name after last dash
  const parts = normalized.split('-')
  const projectName = parts[parts.length - 1].trim().toUpperCase()
  return { monthYear: '', projectName }
}

// Extract city from email subject: "AMARILO | PROJECT NAME | CITY"
export function parseCityFromSubject(subject: string): { projectName: string; city: string } {
  const parts = subject.split('|').map((p) => p.trim())
  if (parts.length >= 3) {
    return {
      projectName: parts[1].replace('JARDINES DEL RIO', '').trim() || parts[1],
      city: parts[2],
    }
  }
  return { projectName: '', city: '' }
}

// Detect project type from text
function detectType(text: string): ProjectType {
  const upper = text.toUpperCase()
  if (upper.includes('NO VIS') || upper.includes('NO-VIS')) return 'NO VIS'
  if (upper.includes('TOPE VIS')) return 'TOPE VIS'
  if (upper.includes('VIS DE RENOVACION') || upper.includes('RENOVACIÓN URBANA')) return 'VIS DE RENOVACION URBANA'
  if (upper.includes('LUXURY')) return 'LUXURY'
  if (upper.includes(' VIP ') || upper.includes('VIP\n')) return 'VIP'
  if (upper.includes(' VIS ') || upper.includes('VIS\n')) return 'VIS'
  return 'NO VIS'
}

// Detect stage from text
function detectStage(text: string): Stage {
  const upper = text.toUpperCase()
  if (upper.includes('EXPECTATIVA')) return 'EXPECTATIVA'
  if (upper.includes('LANZAMIENTO')) return 'LANZAMIENTO'
  return 'SOSTENIMIENTO'
}

// Extract lead goal per torre
function extractLeadGoal(text: string, torreName: string): number {
  const patterns = [
    new RegExp(`Meta de [Ll]eads mensual ${torreName}[\\s\\-–]*([\\d,]+)`, 'i'),
    new RegExp(`${torreName}[\\s\\-–:]+([\\d,]+)\\s*(leads)?`, 'i'),
  ]
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m) return parseInt(m[1].replace(',', ''))
  }
  return 0
}

// Extract budget per torre
function extractBudget(text: string, torreName: string): number {
  const patterns = [
    new RegExp(`${torreName}\\s*\\$[\\s]?([\\d.,]+)`, 'i'),
    new RegExp(`${torreName}.*?\\$\\s*([\\d.,]+)`, 'i'),
  ]
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m) {
      const val = m[1].replace(/\./g, '').replace(',', '.')
      return parseFloat(val)
    }
  }
  return 0
}

// Extract areas for a torre
function extractAreas(text: string, torreName: string): string[] {
  const upper = text.toUpperCase()
  const torIdx = upper.indexOf(torreName.toUpperCase())
  if (torIdx === -1) return []

  const slice = text.substring(torIdx, torIdx + 500)
  const areaMatches = slice.match(/\d+[\s]?m[²2]/gi) || []
  return [...new Set(areaMatches.map((a) => a.trim()))]
}

// Extract audience block for a torre
function extractAudience(text: string, torreName: string): Audience | undefined {
  const upper = text.toUpperCase()
  const start = upper.indexOf(torreName.toUpperCase())
  if (start === -1) return undefined

  const slice = text.substring(start, start + 800)

  const ageMatch = slice.match(/Rango de edad[:\s]+([^\n•]+)/i)
  const motivoMatch = slice.match(/Motivo de compra[:\s]+([^\n•]+)/i)
  const ingresoMatch = slice.match(/Ingresos[:\s]+([^\n•]+)/i)

  return {
    ageRange: ageMatch?.[1]?.trim() || '',
    civilStatus: [],
    cities: [],
    motivation: motivoMatch?.[1]?.trim() || '',
    income: ingresoMatch?.[1]?.trim() || '',
    jobs: [],
    notes: '',
  }
}

// Main brief parser from PDF text
export function parseBriefText(text: string, filename: string, emailSubject?: string): ParsedBrief {
  const { monthYear, projectName } = parseFilename(filename)
  const { city } = emailSubject
    ? parseCityFromSubject(emailSubject)
    : { city: extractCityFromText(text) }

  const type = detectType(text)
  const stage = detectStage(text)

  // Detect torre names: look for headers like "Arrayán", "Samán", "Guayacanes", "Palma"
  const torresDetected = detectTorres(text)

  const torres: TorreData[] = torresDetected.map((torreName) => ({
    name: torreName,
    areas: extractAreas(text, torreName),
    leadGoal: extractLeadGoal(text, torreName),
    budget: extractBudget(text, torreName),
    audience: extractAudience(text, torreName),
    motivo: extractMotivo(text, torreName),
  }))

  // Channels
  const channels = extractChannels(text)

  // RTBs
  const rtbs = extractRTBs(text)

  // Dos and Donts
  const { dos, donts } = extractDosDonts(text)

  // Learnings
  const learnings = extractLearnings(text)

  // Sales room address
  const salesRoomMatch = text.match(/sala de ventas[^:]*:\s*([^\n]+)/i)
  const salesRoomAddress = salesRoomMatch?.[1]?.trim()

  return {
    projectName: projectName || extractProjectNameFromText(text),
    macroProject: projectName || extractProjectNameFromText(text),
    city: city || '',
    type,
    stage,
    monthYear,
    torres,
    channels,
    rtb: rtbs,
    learnings,
    dos,
    donts,
    resources: extractResources(text),
    salesRoomAddress,
  }
}

function extractCityFromText(text: string): string {
  const match = text.match(/(?:ubicado? en|sitúa en|ciudad[\s:]+)([A-ZÁÉÍÓÚÑa-záéíóúñ\s]+(?:,|\.))/i)
  if (match) return match[1].replace(/[,.]/, '').trim()
  if (text.includes('Medellín') || text.includes('Medellin')) return 'Medellín'
  if (text.includes('Bogotá') || text.includes('Bogota')) return 'Bogotá'
  if (text.includes('Barranquilla')) return 'Barranquilla'
  if (text.includes('Cartagena')) return 'Cartagena'
  return ''
}

function extractProjectNameFromText(text: string): string {
  const match = text.match(/NOMBRE DEL PROYECTO\s*\n([^\n]+)/i)
  if (match) return match[1].trim()
  return ''
}

function detectTorres(text: string): string[] {
  // Common torre names for Amarilo projects
  const knownTorres = [
    'Arrayán', 'Samán', 'Guayacanes', 'Palma', 'Santorini', 'Coral',
    'Lira', 'Ibis', 'Torre', 'Altos', 'Serena', 'Bosque', 'River',
  ]

  const found: string[] = []
  for (const torre of knownTorres) {
    const regex = new RegExp(`\\b${torre}\\b`, 'i')
    if (regex.test(text)) {
      found.push(torre)
    }
  }

  // Also look for patterns like "Torre A", "Torre 1"
  const torrePatterns = text.match(/Torre\s+[A-Z0-9]+/gi) || []
  for (const t of torrePatterns) {
    if (!found.includes(t)) found.push(t)
  }

  return found
}

function extractMotivo(text: string, torreName: string): string {
  const idx = text.toUpperCase().indexOf(torreName.toUpperCase())
  if (idx === -1) return ''
  const slice = text.substring(idx, idx + 500)
  const m = slice.match(/Motivo de compra[:\s]+([^\n•]+)/i)
  return m?.[1]?.trim() || ''
}

function extractChannels(text: string): string[] {
  const channels: string[] = []
  const channelKeywords = ['Meta', 'PMAX', 'Google Ads', 'TikTok', 'Programmatic', 'Radio', 'DOOH', 'Influencers', 'Vallas', 'Search']
  for (const ch of channelKeywords) {
    if (new RegExp(ch, 'i').test(text)) channels.push(ch)
  }
  return channels
}

function extractRTBs(text: string): string[] {
  const rtbs: string[] = []
  const matches = text.matchAll(/RTB\s+\d+\s*[–\-:]+\s*([^\n]+)/gi)
  for (const m of matches) {
    rtbs.push(m[1].trim())
  }
  return rtbs
}

function extractDosDonts(text: string): { dos: string[]; donts: string[] } {
  const dos: string[] = []
  const donts: string[] = []

  const dosSection = text.match(/DO[´']?S\s*\n([\s\S]*?)DONT[´']?S/i)
  if (dosSection) {
    const bullets = dosSection[1].match(/[•\-]\s*([^\n]+)/g) || []
    dos.push(...bullets.map((b) => b.replace(/^[•\-]\s*/, '').trim()))
  }

  const dontsSection = text.match(/DONT[´']?S\s*\n([\s\S]*?)(?:\d+\.|$)/i)
  if (dontsSection) {
    const bullets = dontsSection[1].match(/[•\-]\s*([^\n]+)/g) || []
    donts.push(...bullets.map((b) => b.replace(/^[•\-]\s*/, '').trim()))
  }

  return { dos, donts }
}

function extractLearnings(text: string): string[] {
  const section = text.match(/APRENDIZAJES[\s\S]*?\n([\s\S]*?)(?:\d+\.\s*ALCANCE|\n\n\d+\.)/i)
  if (!section) return []
  const bullets = section[1].match(/[•\-]\s*([^\n]+)/g) || []
  return bullets.map((b) => b.replace(/^[•\-]\s*/, '').trim()).filter(Boolean)
}

function extractResources(text: string): string {
  const section = text.match(/recursos contamos[\s\S]*?\n([^\n]+(?:\n[^\n]+)*?)(?:\n\d+\.)/i)
  return section?.[1]?.trim() || ''
}
