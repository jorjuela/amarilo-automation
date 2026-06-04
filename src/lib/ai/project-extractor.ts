import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProjectType, Stage, TorreData } from '@/types'
import { parseBriefText } from '@/lib/brief/parser'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CampaignDetail {
  channels: string[]            // Meta, PMAX, Google Ads, TikTok, DOOH…
  objectives: string[]          // campaign objectives
  rtb: string[]                 // reasons to believe
  targetAudience: string        // audience description
  competition: string           // competitor notes
  tone: string                  // brand tone / voice
  dos: string[]
  donts: string[]
  learnings: string[]           // past learnings
  resources: string             // available resources
  salesRoomAddress: string
  investmentPhases: string[]    // investment phases / timeline
  kpis: string[]                // desired KPIs
  attachmentSummaries: AttachmentSummary[]
}

export interface AttachmentSummary {
  filename: string
  type: 'brief' | 'creative' | 'media_plan' | 'presentation' | 'other'
  summary: string               // 2-3 sentence summary
  keyData: string[]             // bullet points of key data
}

export interface ExtractedProject {
  projectName: string
  macroProject: string
  city: string
  type: ProjectType
  stage: Stage
  monthYear: string
  torres: TorreData[]
  campaign: CampaignDetail
  parseSource: 'AI' | 'REGEX' | 'SUBJECT'
  confidence: 'high' | 'medium' | 'low'
  missingFields: string[]
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const PROJECT_PROMPT = `Eres experto en proyectos inmobiliarios de Amarilo Colombia.
Extrae TODOS los campos del proyecto del siguiente contenido.
Responde SOLO con JSON válido, sin texto adicional:
{
  "projectName": "nombre del proyecto / sala de ventas",
  "macroProject": "nombre del macroproyecto o conjunto",
  "city": "ciudad (Bogotá, Medellín, Cartagena, Cali, etc.)",
  "type": "VIS | NO VIS | TOPE VIS | VIP | VIS DE RENOVACION URBANA | LUXURY",
  "stage": "EXPECTATIVA | LANZAMIENTO | SOSTENIMIENTO",
  "monthYear": "MESAÑO mayúsculas ej ABRIL2026",
  "torres": [{"name":"","areas":[],"leadGoal":0,"budget":0,"motivo":"","ageRange":""}],
  "confidence": "high | medium | low"
}
Reglas:
- type VIS si subsidiado <235 SMMLV; NO VIS si no subsidiado; LUXURY si premium
- stage EXPECTATIVA=pre-lanzamiento; LANZAMIENTO=recién lanzado; SOSTENIMIENTO=en venta
- Si no hay torres, crea una con el nombre del proyecto
- confidence high=nombre+ciudad+tipo+etapa extraídos; medium=falta 1; low=falta 2+`

const CAMPAIGN_PROMPT = `Eres experto en marketing digital inmobiliario colombiano.
Analiza el contenido y extrae el detalle completo de la campaña.
Responde SOLO con JSON válido:
{
  "channels": ["Meta","PMAX","Google Ads","TikTok","Programmatic","DOOH","Radio","OOH","Email","WhatsApp","SMS"],
  "objectives": ["objetivo 1","objetivo 2"],
  "rtb": ["razón para creer 1","razón para creer 2"],
  "targetAudience": "descripción detallada del público objetivo",
  "competition": "información sobre competencia si se menciona",
  "tone": "tono de comunicación / voz de marca",
  "dos": ["sí hacer 1","sí hacer 2"],
  "donts": ["no hacer 1","no hacer 2"],
  "learnings": ["aprendizaje 1","aprendizaje 2"],
  "resources": "descripción de recursos disponibles (videos, fotos, renders)",
  "salesRoomAddress": "dirección de sala de ventas",
  "investmentPhases": ["fase 1: descripción y fechas","fase 2: descripción y fechas"],
  "kpis": ["KPI 1: meta","KPI 2: meta"]
}
Incluye SOLO lo que realmente está en el texto. Arrays vacíos si no aparece el dato.`

const ATTACHMENT_PROMPT = `Analiza este documento adjunto de marketing inmobiliario.
Responde SOLO con JSON válido:
{
  "type": "brief | creative | media_plan | presentation | other",
  "summary": "resumen del documento en 2-3 oraciones",
  "keyData": ["dato clave 1","dato clave 2","dato clave 3","dato clave 4","dato clave 5"]
}`

// ─── AI helpers ───────────────────────────────────────────────────────────────

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-1.5-flash' })
}

function parseJson<T>(text: string): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/)
  return JSON.parse(m ? m[1] : text) as T
}

async function callGemini(prompt: string, content: string): Promise<string> {
  const model = getModel()
  const result = await model.generateContent(`${prompt}\n\nCONTENIDO:\n${content.slice(0, 14000)}`)
  return result.response.text().trim()
}

// ─── Extract project metadata ─────────────────────────────────────────────────

async function extractProjectMeta(
  combinedText: string,
  emailSubject: string,
  emailFrom: string,
): Promise<Omit<ExtractedProject, 'campaign'> | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || combinedText.trim().length < 50) return null

  try {
    const content = `Asunto: ${emailSubject}\nDe: ${emailFrom}\n\n${combinedText}`
    const raw = await callGemini(PROJECT_PROMPT, content)
    const parsed = parseJson<Record<string, unknown>>(raw)

    const validTypes: ProjectType[] = ['VIS', 'NO VIS', 'TOPE VIS', 'VIP', 'VIS DE RENOVACION URBANA', 'LUXURY']
    const validStages: Stage[] = ['EXPECTATIVA', 'LANZAMIENTO', 'SOSTENIMIENTO']

    const type = validTypes.includes(parsed.type as ProjectType) ? parsed.type as ProjectType : 'NO VIS'
    const stage = validStages.includes(parsed.stage as Stage) ? parsed.stage as Stage : 'SOSTENIMIENTO'

    const torres: TorreData[] = ((parsed.torres as Partial<TorreData>[]) || []).map((t) => ({
      name: String(t.name || parsed.projectName || 'Principal'),
      areas: Array.isArray(t.areas) ? t.areas.map(String) : [],
      leadGoal: Number(t.leadGoal) || 0,
      budget: Number(t.budget) || 0,
      motivo: t.motivo ? String(t.motivo) : undefined,
      ageRange: t.ageRange ? String(t.ageRange) : undefined,
    }))
    if (torres.length === 0) torres.push({ name: String(parsed.projectName || 'Principal'), areas: [], leadGoal: 0, budget: 0 })

    const missingFields: string[] = []
    if (!parsed.projectName) missingFields.push('projectName')
    if (!parsed.city) missingFields.push('city')
    if (!parsed.monthYear) missingFields.push('monthYear')

    const conf = parsed.confidence as string
    return {
      projectName: String(parsed.projectName || '').trim(),
      macroProject: String(parsed.macroProject || parsed.projectName || '').trim(),
      city: String(parsed.city || '').trim(),
      type,
      stage,
      monthYear: String(parsed.monthYear || '').trim(),
      torres,
      parseSource: 'AI',
      confidence: ['high', 'medium', 'low'].includes(conf) ? conf as 'high' | 'medium' | 'low' : 'medium',
      missingFields,
    }
  } catch (err) {
    console.error('AI project meta extraction failed:', err)
    return null
  }
}

// ─── Extract campaign detail ──────────────────────────────────────────────────

async function extractCampaignDetail(combinedText: string): Promise<CampaignDetail> {
  const empty: CampaignDetail = {
    channels: [], objectives: [], rtb: [], targetAudience: '', competition: '',
    tone: '', dos: [], donts: [], learnings: [], resources: '', salesRoomAddress: '',
    investmentPhases: [], kpis: [], attachmentSummaries: [],
  }
  if (!process.env.GEMINI_API_KEY || combinedText.trim().length < 50) return empty

  try {
    const raw = await callGemini(CAMPAIGN_PROMPT, combinedText)
    const parsed = parseJson<Record<string, unknown>>(raw)
    const arr = (k: string) => Array.isArray(parsed[k]) ? (parsed[k] as unknown[]).map(String) : []
    const str = (k: string) => String(parsed[k] || '').trim()

    return {
      channels: arr('channels'),
      objectives: arr('objectives'),
      rtb: arr('rtb'),
      targetAudience: str('targetAudience'),
      competition: str('competition'),
      tone: str('tone'),
      dos: arr('dos'),
      donts: arr('donts'),
      learnings: arr('learnings'),
      resources: str('resources'),
      salesRoomAddress: str('salesRoomAddress'),
      investmentPhases: arr('investmentPhases'),
      kpis: arr('kpis'),
      attachmentSummaries: [],
    }
  } catch (err) {
    console.error('Campaign detail extraction failed:', err)
    return empty
  }
}

// ─── Summarize each attachment ────────────────────────────────────────────────

async function summarizeAttachment(filename: string, text: string): Promise<AttachmentSummary> {
  const fallback: AttachmentSummary = { filename, type: 'other', summary: '', keyData: [] }
  if (!process.env.GEMINI_API_KEY || text.trim().length < 50) return fallback

  try {
    const raw = await callGemini(ATTACHMENT_PROMPT, `Archivo: ${filename}\n\n${text}`)
    const parsed = parseJson<Record<string, unknown>>(raw)
    return {
      filename,
      type: (['brief','creative','media_plan','presentation','other'].includes(parsed.type as string)
        ? parsed.type : 'other') as AttachmentSummary['type'],
      summary: String(parsed.summary || '').trim(),
      keyData: Array.isArray(parsed.keyData) ? (parsed.keyData as unknown[]).map(String) : [],
    }
  } catch {
    return fallback
  }
}

// ─── Subject fallback ─────────────────────────────────────────────────────────

function fromSubject(subject: string) {
  const parts = subject.split('|').map((p) => p.trim())
  const name  = parts.length >= 2 ? parts[1] : subject.replace(/AMARILO\s*\|?\s*/i, '').trim()
  const city  = parts.length >= 3 ? parts[2] : ''
  const m     = subject.match(/\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*(\d{4})\b/i)
  return { name: name.toUpperCase(), city: city.toUpperCase(), monthYear: m ? `${m[1].toUpperCase()}${m[2]}` : '' }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export interface TextSource {
  filename: string
  text: string
  isBody?: boolean
}

export async function extractProject(
  sources: TextSource[],
  emailSubject: string,
  emailFrom: string,
): Promise<ExtractedProject> {
  // Build combined text (body first, then attachments with separators)
  const bodySource   = sources.find((s) => s.isBody)
  const pdfSources   = sources.filter((s) => !s.isBody && s.text.trim().length > 50)

  const combinedText = [
    bodySource?.text ?? '',
    ...pdfSources.map((s) => `\n\n=== ADJUNTO: ${s.filename} ===\n${s.text}`),
  ].join('\n').trim()

  const emptyCampaign: CampaignDetail = {
    channels: [], objectives: [], rtb: [], targetAudience: '', competition: '',
    tone: '', dos: [], donts: [], learnings: [], resources: '', salesRoomAddress: '',
    investmentPhases: [], kpis: [], attachmentSummaries: [],
  }

  // 1. AI project metadata + campaign (run concurrently)
  const [aiMeta, campaign] = await Promise.all([
    extractProjectMeta(combinedText, emailSubject, emailFrom),
    extractCampaignDetail(combinedText),
  ])

  // 2. Summarize each attachment separately
  const summaries = await Promise.all(
    pdfSources.map((s) => summarizeAttachment(s.filename, s.text))
  )
  campaign.attachmentSummaries = summaries

  // 3. If AI succeeded with good confidence, return it
  if (aiMeta && aiMeta.projectName && aiMeta.confidence !== 'low') {
    // Fill gaps from subject
    const sub = fromSubject(emailSubject)
    if (!aiMeta.city)       aiMeta.city       = sub.city
    if (!aiMeta.projectName) aiMeta.projectName = sub.name
    if (!aiMeta.macroProject) aiMeta.macroProject = aiMeta.projectName
    if (!aiMeta.monthYear)  aiMeta.monthYear  = sub.monthYear
    return { ...aiMeta, campaign }
  }

  // 4. Regex fallback (use first non-empty text source)
  const mainText = pdfSources[0]?.text || bodySource?.text || ''
  const mainFile = pdfSources[0]?.filename || 'email.txt'
  if (mainText.trim().length > 50) {
    try {
      const brief = parseBriefText(mainText, mainFile, emailSubject)
      if (brief.projectName) {
        const missing: string[] = []
        if (!brief.city)      missing.push('city')
        if (!brief.monthYear) missing.push('monthYear')
        // Merge regex campaign info into AI campaign (AI takes precedence)
        if (campaign.channels.length === 0) campaign.channels = brief.channels
        if (campaign.rtb.length === 0)      campaign.rtb      = brief.rtb
        if (campaign.dos.length === 0)      campaign.dos      = brief.dos
        if (campaign.donts.length === 0)    campaign.donts    = brief.donts
        if (campaign.learnings.length === 0) campaign.learnings = brief.learnings
        if (!campaign.resources)            campaign.resources = brief.resources
        if (!campaign.salesRoomAddress)     campaign.salesRoomAddress = brief.salesRoomAddress || ''
        return {
          projectName: brief.projectName,
          macroProject: brief.macroProject,
          city: brief.city,
          type: brief.type,
          stage: brief.stage,
          monthYear: brief.monthYear,
          torres: brief.torres,
          campaign,
          parseSource: 'REGEX',
          confidence: missing.length === 0 ? 'high' : missing.length === 1 ? 'medium' : 'low',
          missingFields: missing,
        }
      }
    } catch { /* fall through */ }
  }

  // 5. Last resort: subject only
  const sub = fromSubject(emailSubject)
  return {
    projectName: sub.name || emailSubject,
    macroProject: sub.name || emailSubject,
    city: sub.city,
    type: 'NO VIS',
    stage: 'SOSTENIMIENTO',
    monthYear: sub.monthYear,
    torres: [{ name: sub.name || 'Principal', areas: [], leadGoal: 0, budget: 0 }],
    campaign: { ...emptyCampaign, attachmentSummaries: summaries },
    parseSource: 'SUBJECT',
    confidence: 'low',
    missingFields: ['type', 'stage', 'torres', 'monthYear'],
  }
}
