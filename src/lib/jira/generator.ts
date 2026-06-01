import type { Project, TorreData, JiraStructure } from '@/types'
import { MONTHS_ES } from '@/types'

export interface JiraOutput {
  epics: JiraEpic[]
  text: string
  htmlPreview: string
}

export interface JiraEpic {
  name: string
  tasks: JiraTask[]
}

export interface JiraTask {
  name: string
  subtasks: string[]
}

function getMonthAbbr(monthYear: string): string {
  // e.g. "ABRIL2026" -> "Abr"
  const monthName = monthYear.replace(/\d+/, '').toUpperCase()
  return MONTHS_ES[monthName] || monthName.slice(0, 3)
}

export function generateJiraStructure(project: Project & { torres: TorreData[] }): JiraOutput {
  const monthAbbr = getMonthAbbr(project.monthYear || '')
  const city = project.city
  const sala = project.name
  const type = project.type.replace(/ /g, '-')

  const epics: JiraEpic[] = []

  // EPIC: CIUDAD
  const epic: JiraEpic = {
    name: city.toUpperCase(),
    tasks: [],
  }

  for (const torre of project.torres) {
    const macroproyecto = project.macroProject.toUpperCase().replace(/ /g, '-')
    const torreName = torre.name.toUpperCase()

    // TASK: PROYECTO-MACROPROYECTO-CIUDAD-TIPO
    const taskName = `${torreName}-${macroproyecto}-${city.toUpperCase()}-${type}`

    const subtasks: string[] = []
    const deliverables = ['Meta y PMAX', 'Meta', 'PMAX', 'Programmatic Video', 'DOOH-Pantalla', 'DOOH-Ramblas']

    for (const deliverable of deliverables) {
      // SUBTASK: Mes-Proyecto-Macroproyecto-Ciudad-Tema-Tipo
      const subtaskName = `${monthAbbr}-${torreName}-${macroproyecto}-${city.toUpperCase()}-${deliverable}-${type}`
      subtasks.push(subtaskName)
    }

    epic.tasks.push({ name: taskName, subtasks })
  }

  epics.push(epic)

  const text = generatePlainText(epics, sala)
  const htmlPreview = generateHtmlPreview(epics, sala)

  return { epics, text, htmlPreview }
}

function generatePlainText(epics: JiraEpic[], sala: string): string {
  const lines: string[] = []
  lines.push(`=== ESTRUCTURA JIRA - ${sala} ===`)
  lines.push('')

  for (const epic of epics) {
    lines.push(`ÉPICA: ${epic.name}`)
    lines.push('')

    for (const task of epic.tasks) {
      lines.push(`  TAREA: ${task.name}`)
      for (const subtask of task.subtasks) {
        lines.push(`    SUBTAREA: ${subtask}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

function generateHtmlPreview(epics: JiraEpic[], sala: string): string {
  let html = `<div class="jira-structure">`
  html += `<h3 class="text-lg font-bold mb-4 text-gray-800">Estructura JIRA — ${sala}</h3>`

  for (const epic of epics) {
    html += `<div class="epic-block mb-6">`
    html += `<div class="epic-header flex items-center gap-2 mb-2">`
    html += `<span class="px-2 py-1 bg-purple-600 text-white text-xs font-bold rounded">ÉPICA</span>`
    html += `<span class="font-bold text-purple-800">${epic.name}</span>`
    html += `</div>`

    for (const task of epic.tasks) {
      html += `<div class="task-block ml-6 mb-4">`
      html += `<div class="task-header flex items-center gap-2 mb-1">`
      html += `<span class="px-2 py-1 bg-blue-500 text-white text-xs font-bold rounded">TAREA</span>`
      html += `<span class="font-semibold text-blue-800">${task.name}</span>`
      html += `</div>`

      for (const subtask of task.subtasks) {
        html += `<div class="subtask ml-6 flex items-center gap-2 py-1">`
        html += `<span class="px-2 py-0.5 bg-green-400 text-white text-xs font-bold rounded">SUBTAREA</span>`
        html += `<span class="text-green-800">${subtask}</span>`
        html += `</div>`
      }

      html += `</div>`
    }

    html += `</div>`
  }

  html += `</div>`
  return html
}

export function generateJiraStructuresForProject(
  project: Project & { torres: TorreData[] }
): JiraStructure[] {
  const monthAbbr = getMonthAbbr(project.monthYear || '')
  const structures: JiraStructure[] = []

  for (const torre of project.torres) {
    const macroproyecto = project.macroProject.toUpperCase().replace(/ /g, '-')
    const torreName = torre.name.toUpperCase()
    const city = project.city.toUpperCase()
    const type = project.type.replace(/ /g, '-')

    const epic = city
    const task = `${torreName}-${macroproyecto}-${city}-${type}`

    const deliverables = [
      { label: 'Meta y PMAX', type: 'Meta-PMAX' },
      { label: 'Meta', type: 'Meta' },
      { label: 'PMAX', type: 'PMAX' },
      { label: 'Programmatic Video', type: 'Programmatic' },
    ]

    for (const d of deliverables) {
      const subtask = `${monthAbbr}-${torreName}-${macroproyecto}-${city}-${d.label}-${type}`
      structures.push({
        epic,
        task,
        subtask,
        month: monthAbbr,
        type: d.type,
        projectId: project.id,
      })
    }
  }

  return structures
}
