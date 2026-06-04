import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ParsedBrief, ProjectType, Stage, TorreData } from '@/types'
import { parseBriefText } from '@/lib/brief/parser'

export interface ExtractedProject {
  projectName: string
  macroProject: string
  city: string
  type: ProjectType
  stage: Stage
  monthYear: string
  torres: TorreData[]
  channels: string[]
  rtb: string[]
  dos: string[]
  donts: string[]
  learnings: string[]
  resources: string
  salesRoomAddress: string
  parseSource: 'AI' | 'REGEX' | 'SUBJECT'
  confidence: 'high' | 'medium' | 'low'
  missingFields: string[]
}

const EXTRACT_PROMPT = `Eres un experto en proyectos inmobiliarios de Amarilo Colombia.
Analiza el siguiente contenido de un email o brief de marketing y extrae TODOS los campos del proyecto.

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta (sin texto adicional):
{
  "projectName": "nombre del proyecto/sala de ventas (ej: JARDINES DEL RIO, CORAL II, SANTORINI)",
  "macroProject": "nombre del macroproyecto o del conjunto (puede ser igual a projectName)",
  "city": "ciudad donde está el proyecto (Bogotá, Medellín, Cartagena, etc.)",
  "type": "VIS | NO VIS | TOPE VIS | VIP | VIS DE RENOVACION URBANA | LUXURY",
  "stage": "EXPECTATIVA | LANZAMIENTO | SOSTENIMIENTO",
  "monthYear": "mes y año del brief como MESAÑO ej: ABRIL2026, JUNIO2026",
  "torres": [
    {
      "name": "nombre de la torre o etapa",
      "areas": ["áreas disponibles como 30m², 45m²"],
      "leadGoal": 150,
      "budget": 50000000,
      "motivo": "Habitar | Inversión | ambos",
      "ageRange": "rango de edad del público objetivo ej: 28-45 años"
    }
  ],
  "channels": ["Meta", "PMAX", "Google Ads", "TikTok", "Programmatic", "DOOH", "Radio"],
  "rtb": ["razón para creer 1", "razón para creer 2"],
  "dos": ["do 1", "do 2"],
  "donts": ["dont 1", "dont 2"],
  "learnings": ["aprendizaje 1"],
  "resources": "descripción de recursos disponibles",
  "salesRoomAddress": "dirección de la sala de ventas si se menciona",
  "confidence": "high | medium | low"
}

Reglas:
- Si el campo no está en el texto, usa "" para strings, [] para arrays, 0 para números
- Para type: VIS si precio < 235 SMMLV, NO VIS si no está subsidiado, LUXURY si es premium
- Para stage: EXPECTATIVA si es pre-lanzamiento/expectativa, LANZAMIENTO si acaba de lanzar, SOSTENIMIENTO si ya está en venta
- Si hay múltiples torres/etapas, créalas todas en el array torres
- Si no hay torres definidas, crea una con el mismo nombre del proyecto
- monthYear: formato MEESAÑO en mayúsculas (ENERO2026, FEBRERO2026, etc.)
- confidence: high si extraíste nombre+ciudad+tipo+etapa, medium si falta alguno, low si casi todo está vacío`

export async function extractProjectWithAI(
  rawText: string,
  emailSubject: string,
  emailFrom: string
): Promise<ExtractedProject | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || rawText.trim().length < 50) return null

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const prompt = `${EXTRACT_PROMPT}

Asunto del email: ${emailSubject}
De: ${emailFrom}

CONTENIDO:
${rawText.slice(0, 14000)}`

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()

    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1] : text
    const parsed = JSON.parse(jsonStr)

    const torres: TorreData[] = (parsed.torres || []).map((t: Partial<TorreData>) => ({
      name: String(t.name || parsed.projectName || 'Torre Principal'),
      areas: Array.isArray(t.areas) ? t.areas.map(String) : [],
      leadGoal: Number(t.leadGoal) || 0,
      budget: Number(t.budget) || 0,
      motivo: t.motivo ? String(t.motivo) : undefined,
      ageRange: t.ageRange ? String(t.ageRange) : undefined,
    }))

    // Ensure at least one torre
    if (torres.length === 0) {
      torres.push({
        name: parsed.projectName || 'Principal',
        areas: [],
        leadGoal: 0,
        budget: 0,
      })
    }

    const validTypes: ProjectType[] = ['VIS', 'NO VIS', 'TOPE VIS', 'VIP', 'VIS DE RENOVACION URBANA', 'LUXURY']
    const validStages: Stage[] = ['EXPECTATIVA', 'LANZAMIENTO', 'SOSTENIMIENTO']

    const type = validTypes.includes(parsed.type) ? parsed.type as ProjectType : 'NO VIS'
    const stage = validStages.includes(parsed.stage) ? parsed.stage as Stage : 'SOSTENIMIENTO'

    const missingFields: string[] = []
    if (!parsed.projectName) missingFields.push('projectName')
    if (!parsed.city) missingFields.push('city')
    if (!parsed.monthYear) missingFields.push('monthYear')

    return {
      projectName: String(parsed.projectName || '').trim(),
      macroProject: String(parsed.macroProject || parsed.projectName || '').trim(),
      city: String(parsed.city || '').trim(),
      type,
      stage,
      monthYear: String(parsed.monthYear || '').trim(),
      torres,
      channels: Array.isArray(parsed.channels) ? parsed.channels.map(String) : [],
      rtb: Array.isArray(parsed.rtb) ? parsed.rtb.map(String) : [],
      dos: Array.isArray(parsed.dos) ? parsed.dos.map(String) : [],
      donts: Array.isArray(parsed.donts) ? parsed.donts.map(String) : [],
      learnings: Array.isArray(parsed.learnings) ? parsed.learnings.map(String) : [],
      resources: String(parsed.resources || '').trim(),
      salesRoomAddress: String(parsed.salesRoomAddress || '').trim(),
      parseSource: 'AI',
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
      missingFields,
    }
  } catch (err) {
    console.error('AI project extraction failed:', err)
    return null
  }
}

function parsedBriefToExtracted(brief: ParsedBrief): ExtractedProject {
  const missingFields: string[] = []
  if (!brief.projectName) missingFields.push('projectName')
  if (!brief.city) missingFields.push('city')
  if (!brief.monthYear) missingFields.push('monthYear')

  return {
    projectName: brief.projectName,
    macroProject: brief.macroProject,
    city: brief.city,
    type: brief.type,
    stage: brief.stage,
    monthYear: brief.monthYear,
    torres: brief.torres,
    channels: brief.channels,
    rtb: brief.rtb,
    dos: brief.dos,
    donts: brief.donts,
    learnings: brief.learnings,
    resources: brief.resources,
    salesRoomAddress: brief.salesRoomAddress || '',
    parseSource: 'REGEX',
    confidence: missingFields.length === 0 ? 'high' : missingFields.length === 1 ? 'medium' : 'low',
    missingFields,
  }
}

// Extract project name and city from email subject "AMARILO | PROJECT | CITY"
function extractFromSubject(subject: string): { name: string; city: string; monthYear: string } {
  const parts = subject.split('|').map((p) => p.trim())
  const name = parts.length >= 2 ? parts[1] : subject.replace(/AMARILO\s*\|?\s*/i, '').trim()
  const city = parts.length >= 3 ? parts[2] : ''

  // Try to extract month/year from subject
  const monthYearMatch = subject.match(/\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*(\d{4})\b/i)
  const monthYear = monthYearMatch ? `${monthYearMatch[1].toUpperCase()}${monthYearMatch[2]}` : ''

  return { name: name.toUpperCase(), city: city.toUpperCase(), monthYear }
}

// Main extraction pipeline: AI → Regex → Subject fallback
export async function extractProject(
  rawText: string,
  filename: string,
  emailSubject: string,
  emailFrom: string
): Promise<ExtractedProject> {
  // 1. Try Gemini AI first (most reliable for dynamic briefs)
  const aiResult = await extractProjectWithAI(rawText, emailSubject, emailFrom)
  if (aiResult && aiResult.projectName && aiResult.confidence !== 'low') {
    // Fill missing fields from subject if AI didn't get them
    if (!aiResult.city || !aiResult.projectName) {
      const fromSubject = extractFromSubject(emailSubject)
      if (!aiResult.projectName) aiResult.projectName = fromSubject.name
      if (!aiResult.macroProject) aiResult.macroProject = fromSubject.name
      if (!aiResult.city) aiResult.city = fromSubject.city
      if (!aiResult.monthYear) aiResult.monthYear = fromSubject.monthYear
    }
    return aiResult
  }

  // 2. Fallback: regex-based parser
  if (rawText.trim().length > 50) {
    try {
      const brief = parseBriefText(rawText, filename, emailSubject)
      const regexResult = parsedBriefToExtracted(brief)
      if (regexResult.projectName) {
        // Supplement with AI partial results if available
        if (aiResult) {
          if (!regexResult.city && aiResult.city) regexResult.city = aiResult.city
          if (!regexResult.monthYear && aiResult.monthYear) regexResult.monthYear = aiResult.monthYear
          if (regexResult.torres.length === 0 && aiResult.torres.length > 0) regexResult.torres = aiResult.torres
        }
        return regexResult
      }
    } catch (err) {
      console.error('Regex parser failed:', err)
    }
  }

  // 3. Last resort: extract from subject line only
  const fromSubject = extractFromSubject(emailSubject)
  return {
    projectName: fromSubject.name || emailSubject,
    macroProject: fromSubject.name || emailSubject,
    city: fromSubject.city,
    type: 'NO VIS',
    stage: 'SOSTENIMIENTO',
    monthYear: fromSubject.monthYear,
    torres: [{ name: fromSubject.name || 'Principal', areas: [], leadGoal: 0, budget: 0 }],
    channels: [],
    rtb: [],
    dos: [],
    donts: [],
    learnings: [],
    resources: '',
    salesRoomAddress: '',
    parseSource: 'SUBJECT',
    confidence: 'low',
    missingFields: ['type', 'stage', 'torres', 'monthYear'],
  }
}
