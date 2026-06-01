import ExcelJS from 'exceljs'
import type { TrafficEntry, TrafficWeek } from '@/types'
import { TEAM_MEMBERS, DAYS_OF_WEEK } from '@/types'
import { format, startOfWeek, addDays } from 'date-fns'
import { es } from 'date-fns/locale'

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1B3D6B' }, // dark navy
}
const COPY_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF9C4' }, // light yellow
}
const GRAPHIC_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE1F5FE' }, // light blue
}
const STRATEGIST_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8F5E9' }, // light green
}
const AMARILO_YELLOW: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFABD02' }, // amarilo yellow
}
const DARK_ROW: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF3C3C3C' }, // dark separator
}

function bold(size = 10): Partial<ExcelJS.Font> {
  return { bold: true, size }
}
function white(): Partial<ExcelJS.Font> {
  return { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 }
}

function setBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  }
}

export function getWeeksInMonth(year: number, month: number): TrafficWeek[] {
  const weeks: TrafficWeek[] = []
  const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const monthAbbr = monthNames[month - 1]

  let weekNum = 1
  const firstDay = new Date(year, month - 1, 1)
  let current = startOfWeek(firstDay, { weekStartsOn: 1 })

  while (current.getMonth() <= month - 1 || current <= new Date(year, month - 1, 31)) {
    const weekStart = current
    const weekEnd = addDays(current, 4)

    if (weekStart.getMonth() === month - 1 || weekEnd.getMonth() === month - 1) {
      weeks.push({
        weekLabel: `${monthAbbr} S${weekNum}`,
        weekStart: format(weekStart, 'yyyy-MM-dd'),
        weekEnd: format(weekEnd, 'yyyy-MM-dd'),
        entries: [],
      })
      weekNum++
    }

    current = addDays(current, 7)
    if (weekStart.getMonth() > month - 1) break
    if (weekNum > 5) break
  }

  return weeks
}

export async function generateTrafficExcel(
  entries: TrafficEntry[],
  weekData: TrafficWeek,
  projectName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Amarilo Automation'
  workbook.created = new Date()

  const weekDays = DAYS_OF_WEEK
  const sheet = workbook.addWorksheet(weekData.weekLabel)

  sheet.pageSetup.paperSize = 9 // A4
  sheet.pageSetup.orientation = 'landscape'

  // Column widths
  sheet.columns = [
    { width: 12 }, // Day / DICS label
    { width: 20 }, // Name / Campaña
    { width: 15 }, // PM
    { width: 35 }, // Requerimiento
    { width: 8  }, // #Textos
    { width: 15 }, // Copy
    { width: 8  }, // #Gráficas
    { width: 15 }, // Gráfico
    { width: 12 }, // Estado
    { width: 15 }, // Jira
  ]

  // ── DICS label (col A, rows 1-13) ──
  const dicsRows = 1 + TEAM_MEMBERS.copy.length + TEAM_MEMBERS.graphic.length + TEAM_MEMBERS.strategist.length + 2

  // Row 1: Anotaciones + LUNES..VIERNES headers
  const r1 = sheet.getRow(1)
  r1.getCell(2).value = 'Anotaciones generales'
  r1.getCell(2).font = { bold: true, size: 10 }

  // Day headers start at col 3 (C)
  const dayStartCol = 3
  const weekStartDate = new Date(weekData.weekStart)
  weekDays.forEach((day, i) => {
    const col = dayStartCol + i
    const date = addDays(weekStartDate, i)
    const cell = r1.getCell(col)
    cell.value = `${day.toUpperCase().slice(0, 3)} ${format(date, 'd')}`
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3D6B' } }
    cell.font = white()
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    setBorder(cell)
  })

  // Merge DICS label (A1:A{dicsRows})
  sheet.mergeCells(1, 1, dicsRows, 1)
  const dicsCell = sheet.getCell(1, 1)
  dicsCell.value = 'D I C S'
  dicsCell.font = { bold: true, size: 14, color: { argb: 'FF1B3D6B' } }
  dicsCell.alignment = { textRotation: 90, vertical: 'middle', horizontal: 'center' }
  dicsCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }

  // ── Team member rows ──
  let rowIdx = 2

  // Copy section header
  const copyHeaderRow = sheet.getRow(rowIdx)
  copyHeaderRow.getCell(2).value = 'Copy'
  copyHeaderRow.getCell(2).font = bold()
  copyHeaderRow.getCell(2).fill = AMARILO_YELLOW
  sheet.mergeCells(rowIdx, 2, rowIdx, 2)
  rowIdx++

  for (const member of TEAM_MEMBERS.copy) {
    const row = sheet.getRow(rowIdx)
    row.getCell(2).value = member
    row.getCell(2).font = bold()
    row.getCell(2).fill = COPY_FILL

    for (let d = 0; d < weekDays.length; d++) {
      const dayEntries = entries.filter(
        (e) => e.dayOfWeek === weekDays[d] && e.copyName === member
      )
      const totalTexts = dayEntries.reduce((sum, e) => sum + (e.numTexts || 0), 0)
      const cell = row.getCell(dayStartCol + d)
      cell.value = totalTexts || 0
      cell.alignment = { horizontal: 'center' }
      cell.fill = COPY_FILL
      setBorder(cell)
    }
    rowIdx++
  }

  // Graphic section header
  const gfxHeaderRow = sheet.getRow(rowIdx)
  gfxHeaderRow.getCell(2).value = 'Gráfico'
  gfxHeaderRow.getCell(2).font = bold()
  gfxHeaderRow.getCell(2).fill = AMARILO_YELLOW
  rowIdx++

  for (const member of TEAM_MEMBERS.graphic) {
    const row = sheet.getRow(rowIdx)
    row.getCell(2).value = member
    row.getCell(2).font = bold()
    row.getCell(2).fill = GRAPHIC_FILL

    for (let d = 0; d < weekDays.length; d++) {
      const dayEntries = entries.filter(
        (e) => e.dayOfWeek === weekDays[d] && e.graphicName === member
      )
      const totalGraphics = dayEntries.reduce((sum, e) => sum + (e.numGraphics || 0), 0)
      const cell = row.getCell(dayStartCol + d)
      cell.value = totalGraphics || 0
      cell.alignment = { horizontal: 'center' }
      cell.fill = GRAPHIC_FILL
      setBorder(cell)
    }
    rowIdx++
  }

  // Strategist section
  for (const member of TEAM_MEMBERS.strategist) {
    const row = sheet.getRow(rowIdx)
    row.getCell(2).value = 'Strategist'
    row.getCell(3 - 1).value = member  // Inline with strategist label
    row.getCell(2).font = bold()
    row.getCell(2).fill = STRATEGIST_FILL

    for (let d = 0; d < weekDays.length; d++) {
      const cell = row.getCell(dayStartCol + d)
      cell.value = 0
      cell.fill = STRATEGIST_FILL
      setBorder(cell)
    }
    rowIdx++
  }

  // Total row
  const totalRow = sheet.getRow(rowIdx)
  totalRow.getCell(2).value = 'Total'
  totalRow.getCell(2).font = { bold: true, size: 10 }
  totalRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

  for (let d = 0; d < weekDays.length; d++) {
    const dayEntries = entries.filter((e) => e.dayOfWeek === weekDays[d])
    const total = dayEntries.reduce((sum, e) => sum + (e.numTexts || 0) + (e.numGraphics || 0), 0)
    const cell = totalRow.getCell(dayStartCol + d)
    cell.value = total
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }
    setBorder(cell)
  }
  rowIdx++

  // ── Task detail table ──
  const tableHeaderRow = sheet.getRow(rowIdx)
  const tableHeaders = ['', 'Campaña', 'PM', 'Requerimiento', '# Textos', 'Copy', '# Gráficas', 'Gráfico', 'Estado', 'Jira']

  tableHeaders.forEach((h, i) => {
    const cell = tableHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font = white()
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    setBorder(cell)
  })
  rowIdx++

  // Group entries by day
  for (const day of weekDays) {
    const dayEntries = entries.filter((e) => e.dayOfWeek === day)

    if (dayEntries.length === 0) {
      // Add empty rows for each day
      for (let i = 0; i < 14; i++) {
        const row = sheet.getRow(rowIdx)
        row.getCell(1).value = i === 0 ? day : ''
        row.getCell(1).font = { bold: i === 0, size: 10 }
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 0 ? 'FFFABD02' : 'FFFFFFFF' } }
        for (let c = 1; c <= 10; c++) setBorder(row.getCell(c))
        rowIdx++
      }
    } else {
      for (let i = 0; i < Math.max(dayEntries.length, 14); i++) {
        const entry = dayEntries[i]
        const row = sheet.getRow(rowIdx)
        row.getCell(1).value = i === 0 ? day : ''
        row.getCell(1).font = { bold: i === 0, size: 10 }
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 0 ? 'FFFABD02' : 'FFFFFFFF' } }

        if (entry) {
          row.getCell(2).value = entry.campaign || ''
          row.getCell(3).value = entry.pm || ''
          row.getCell(4).value = entry.requirement || ''
          row.getCell(5).value = entry.numTexts || 0
          row.getCell(6).value = entry.copyName || ''
          row.getCell(7).value = entry.numGraphics || 0
          row.getCell(8).value = entry.graphicName || ''
          row.getCell(9).value = entry.status || ''
          row.getCell(10).value = entry.jiraTicket || ''
        }

        for (let c = 1; c <= 10; c++) setBorder(row.getCell(c))
        rowIdx++
      }
    }

    // Dark separator row between days
    const sepRow = sheet.getRow(rowIdx)
    for (let c = 1; c <= 10; c++) {
      sepRow.getCell(c).fill = DARK_ROW
    }
    rowIdx++
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
