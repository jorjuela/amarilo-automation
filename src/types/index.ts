export type Stage = 'EXPECTATIVA' | 'LANZAMIENTO' | 'SOSTENIMIENTO'
export type ProjectType = 'VIS' | 'NO VIS' | 'TOPE VIS' | 'VIP' | 'VIS DE RENOVACION URBANA' | 'LUXURY'

export interface Audience {
  ageRange: string
  civilStatus: string[]
  cities: string[]
  motivation: string
  income: string
  jobs: string[]
  notes: string
}

export interface TorreData {
  id?: string
  name: string
  areas: string[]
  leadGoal: number
  budget: number
  audience?: Audience | null
  motivo?: string | null
  ageRange?: string | null
}

export interface Project {
  id: string
  createdAt: string | Date
  updatedAt: string | Date
  name: string
  macroProject: string
  city: string
  type: ProjectType | string
  stage: Stage | string
  status: string
  briefFileName?: string | null
  briefParsedAt?: string | Date | null
  briefRawText?: string | null
  briefData?: string | null        // JSON: CampaignDetail
  briefBlocks?: string | null      // JSON: ProjectBlocks
  emailThreadId?: string | null
  parseSource?: string | null      // AI | REGEX | SUBJECT
  parseConfidence?: string | null  // high | medium | low
  needsReview?: boolean
  monthYear?: string | null
  emailSubject?: string | null
  emailReceivedAt?: string | Date | null
  emailMessageId?: string | null
  googleSheetId?: string | null
  googleSheetUrl?: string | null
  torres: TorreData[]
}

export interface ParsedBrief {
  projectName: string
  macroProject: string
  city: string
  type: ProjectType
  stage: Stage
  monthYear: string
  torres: TorreData[]
  competition?: string
  channels: string[]
  rtb: string[]
  learnings: string[]
  dos: string[]
  donts: string[]
  resources: string
  salesRoomAddress?: string
}

export interface TrafficEntry {
  id?: string
  weekStart: string
  weekEnd: string
  weekLabel: string
  dayOfWeek: string
  campaign: string
  pm: string
  requirement: string
  numTexts: number
  copyName?: string
  numGraphics: number
  graphicName?: string
  status: string
  jiraTicket?: string
  notes?: string
  projectId: string
  aiGenerated?: boolean
}

export interface TrafficWeek {
  weekLabel: string
  weekStart: string
  weekEnd: string
  entries: TrafficEntry[]
}

export interface JiraStructure {
  id?: string
  epic: string
  task: string
  subtask: string
  month: string
  type: string
  projectId: string
}

export interface InventoryRow {
  especialista: string
  ciudad: string
  sala: string
  proyecto: string
  tipo: string
  etapa: string
  activoMeta: string
  activoPmax: string
  metaEstatico: number
  metaCarrusel: number
  metaVideo: number
  pmaxEstatico: number
  pmaxVideo: number
  pmaxTextosCortos: number
  pmaxTextosLargos: number
  pmaxDescripciones: number
  nuevoEstatico: number
  nuevoEstaticoAdaptacion: number
  nuevoVideo: number
  nuevoVideoAdaptacion: number
}

export interface StatusRow {
  especialista: string
  ciudad: string
  sala: string
  proyecto: string
  tipo: string
  entregable: string
  prioridad: string
  estatus: string
  recepcion: string
  creatividadInicio: string
  creatividadEntrega: string
  produccionInicio: string
  produccionEntrega: string
  comentarios: string
}

export interface AppSettings {
  gmail: {
    clientId: string
    clientSecret: string
    refreshToken: string
    email: string
  }
  googleDrive: {
    folderId: string
    clientEmail: string
    privateKey: string
  }
  jira: {
    boardUrl: string
    projectKey: string
  }
  team: {
    copy: string[]
    graphic: string[]
    strategist: string[]
    pms: string[]
  }
  emailSubjectPattern: string
}

export const TEAM_MEMBERS = {
  copy: ['Jaime', 'Laura G', 'Nata', 'Nico P'],
  graphic: ['Nico', 'Andres S', 'Angie', 'Sebas', 'Carlos', 'Dani S', 'Andrés C'],
  strategist: ['Nico G'],
}

export const DAYS_OF_WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']

export const MONTHS_ES: Record<string, string> = {
  ENERO: 'Ene', FEBRERO: 'Feb', MARZO: 'Mar', ABRIL: 'Abr',
  MAYO: 'May', JUNIO: 'Jun', JULIO: 'Jul', AGOSTO: 'Ago',
  SEPTIEMBRE: 'Sep', OCTUBRE: 'Oct', NOVIEMBRE: 'Nov', DICIEMBRE: 'Dic',
}

export const STAGE_COLORS: Record<Stage, string> = {
  EXPECTATIVA: 'bg-pink-100 text-pink-800 border-pink-200',
  LANZAMIENTO: 'bg-orange-100 text-orange-800 border-orange-200',
  SOSTENIMIENTO: 'bg-yellow-100 text-yellow-800 border-yellow-200',
}

export const STAGE_LABELS: Record<Stage, string> = {
  EXPECTATIVA: 'Expectativa (45 días)',
  LANZAMIENTO: 'Lanzamiento (3 meses)',
  SOSTENIMIENTO: 'Sostenimiento (+4 meses)',
}
