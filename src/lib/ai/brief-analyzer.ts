import { GoogleGenerativeAI } from '@google/generative-ai'

export interface BriefTask {
  type: 'COPY' | 'GRAFICO'
  campaign: string       // project/torre name
  city: string
  requirement: string    // description of the deliverable
  numTexts: number
  numGraphics: number
  hoursEstimated: number // hours to complete this task
  channel: string        // Meta, PMAX, Email, etc.
  priority: 'alta' | 'media' | 'baja'
}

export interface BriefAnalysis {
  tasks: BriefTask[]
  summary: string
  totalCopyHours: number
  totalGraphicHours: number
}

const SYSTEM_PROMPT = `Eres un experto en planificación de tráfico creativo para proyectos inmobiliarios.
Analiza el brief de marketing y extrae TODAS las tareas creativas que necesita el equipo.

Para cada tarea identifica:
- type: "COPY" si requiere redacción/textos, "GRAFICO" si requiere diseño/imágenes/videos
- campaign: nombre del proyecto o torre específico
- city: ciudad del proyecto
- requirement: descripción concisa de la entrega (ej: "KV estáticos Meta", "Textos pauta PMAX", "Video macroproyecto")
- numTexts: cantidad de textos/copies a producir (0 si no aplica)
- numGraphics: cantidad de piezas gráficas/visuales a producir (0 si no aplica)
- hoursEstimated: horas de trabajo estimadas (Copy: 1h por texto corto, 2h por texto largo; Gráfico: 2h estático, 4h adaptación, 8h video, 6h KV)
- channel: canal de pauta (Meta, PMAX, Email, Jira, OOH, etc.)
- priority: "alta" para lanzamiento/KV, "media" para adaptaciones, "baja" para ajustes menores

Responde ÚNICAMENTE con un JSON válido con esta estructura:
{
  "tasks": [...],
  "summary": "resumen en 1 oración"
}

No incluyas texto fuera del JSON.`

export async function analyzeBrief(briefText: string, projectName: string, city: string): Promise<BriefAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const prompt = `${SYSTEM_PROMPT}

Proyecto: ${projectName}
Ciudad: ${city}

BRIEF:
${briefText.slice(0, 12000)}`

  const result = await model.generateContent(prompt)
  const text = result.response.text().trim()

  // Extract JSON from response (may be wrapped in ```json blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/)
  const jsonStr = jsonMatch ? jsonMatch[1] : text

  const parsed = JSON.parse(jsonStr)

  const tasks: BriefTask[] = (parsed.tasks || []).map((t: Partial<BriefTask>) => ({
    type: t.type === 'COPY' ? 'COPY' : 'GRAFICO',
    campaign: t.campaign || projectName,
    city: t.city || city,
    requirement: t.requirement || '',
    numTexts: Number(t.numTexts) || 0,
    numGraphics: Number(t.numGraphics) || 0,
    hoursEstimated: Number(t.hoursEstimated) || 2,
    channel: t.channel || 'Meta',
    priority: t.priority || 'media',
  }))

  const totalCopyHours = tasks.filter((t) => t.type === 'COPY').reduce((s, t) => s + t.hoursEstimated, 0)
  const totalGraphicHours = tasks.filter((t) => t.type === 'GRAFICO').reduce((s, t) => s + t.hoursEstimated, 0)

  return { tasks, summary: parsed.summary || '', totalCopyHours, totalGraphicHours }
}
