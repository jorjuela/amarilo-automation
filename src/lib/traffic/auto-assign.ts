import { isWorkingDay, nextWorkingDay, DAY_NAMES_ES } from '@/lib/holidays'
import type { BriefTask } from '@/lib/ai/brief-analyzer'
import { startOfWeek, endOfWeek, format } from 'date-fns'
import { es } from 'date-fns/locale'

export interface AssignedTask {
  date: Date
  dayOfWeek: string
  weekLabel: string
  weekStart: Date
  weekEnd: Date
  campaign: string
  city: string
  requirement: string
  numTexts: number
  copyName: string | null
  numGraphics: number
  graphicName: string | null
  status: string
  hoursEstimated: number
  aiGenerated: boolean
  pm: string
}

interface CollaboratorLoad {
  name: string
  role: 'COPY' | 'GRAFICO'
  hoursUsed: Record<string, number> // ISO date key → hours
}

const MAX_HOURS_PER_DAY = 8

function getWeekLabel(date: Date): string {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })
  const monthLabel = format(weekStart, 'MMM', { locale: es }).toUpperCase().slice(0, 3)
  // Week number within the month (1-based)
  const firstMonday = startOfWeek(new Date(weekStart.getFullYear(), weekStart.getMonth(), 1), { weekStartsOn: 1 })
  const weekNum = Math.ceil((weekStart.getDate() - firstMonday.getDate()) / 7) + 1
  return `${monthLabel} W${weekNum}`
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getDayName(d: Date): string {
  const dow = d.getDay()
  return DAY_NAMES_ES[dow] ?? 'Lunes'
}

// Find the next available day for a collaborator given their current load
function findAvailableDay(
  collab: CollaboratorLoad,
  startDate: Date,
  hoursNeeded: number,
  maxLookAheadDays = 60
): Date | null {
  let d = new Date(startDate)
  for (let i = 0; i < maxLookAheadDays; i++) {
    if (isWorkingDay(d)) {
      const used = collab.hoursUsed[dateKey(d)] ?? 0
      if (used + hoursNeeded <= MAX_HOURS_PER_DAY) return d
    }
    d = new Date(d)
    d.setDate(d.getDate() + 1)
  }
  return null
}

// Pick least-loaded collaborator available on or after startDate
function assignCollaborator(
  pool: CollaboratorLoad[],
  startDate: Date,
  hoursNeeded: number
): { collab: CollaboratorLoad; assignedDate: Date } | null {
  let best: { collab: CollaboratorLoad; assignedDate: Date } | null = null

  for (const collab of pool) {
    const day = findAvailableDay(collab, startDate, hoursNeeded)
    if (!day) continue
    if (!best || dateKey(day) < dateKey(best.assignedDate)) {
      best = { collab, assignedDate: day }
    }
  }

  return best
}

export function autoAssignTasks(
  tasks: BriefTask[],
  copyCollaborators: string[],
  graphicCollaborators: string[],
  startDate: Date
): AssignedTask[] {
  // Initialize load tracking
  const copyPool: CollaboratorLoad[] = copyCollaborators.map((name) => ({
    name, role: 'COPY', hoursUsed: {},
  }))
  const graphicPool: CollaboratorLoad[] = graphicCollaborators.map((name) => ({
    name, role: 'GRAFICO', hoursUsed: {},
  }))

  // Sort tasks by priority: alta → media → baja
  const priorityOrder = { alta: 0, media: 1, baja: 2 }
  const sorted = [...tasks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  const assigned: AssignedTask[] = []

  for (const task of sorted) {
    if (task.type === 'COPY' && copyPool.length === 0) continue
    if (task.type === 'GRAFICO' && graphicPool.length === 0) continue

    const pool = task.type === 'COPY' ? copyPool : graphicPool
    const result = assignCollaborator(pool, startDate, task.hoursEstimated)
    if (!result) continue

    const { collab, assignedDate } = result

    // Book the hours
    const dk = dateKey(assignedDate)
    collab.hoursUsed[dk] = (collab.hoursUsed[dk] ?? 0) + task.hoursEstimated

    const weekStart = startOfWeek(assignedDate, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(assignedDate, { weekStartsOn: 1 })
    const weekLabel = getWeekLabel(assignedDate)

    assigned.push({
      date: assignedDate,
      dayOfWeek: getDayName(assignedDate),
      weekLabel,
      weekStart,
      weekEnd,
      campaign: task.campaign,
      city: task.city,
      requirement: `[${task.channel}] ${task.requirement}`,
      numTexts: task.type === 'COPY' ? task.numTexts || 1 : 0,
      copyName: task.type === 'COPY' ? collab.name : null,
      numGraphics: task.type === 'GRAFICO' ? task.numGraphics || 1 : 0,
      graphicName: task.type === 'GRAFICO' ? collab.name : null,
      status: 'pending',
      hoursEstimated: task.hoursEstimated,
      aiGenerated: true,
      pm: '',
    })
  }

  return assigned.sort((a, b) => a.date.getTime() - b.date.getTime())
}
