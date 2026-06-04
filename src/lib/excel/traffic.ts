import ExcelJS from 'exceljs'
import type { TrafficEntry, TrafficWeek } from '@/types'
import { DAYS_OF_WEEK } from '@/types'
import { format, addDays, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  navy:       'FF1B3D6B',
  yellow:     'FFFABD02',
  redLabel:   'FFCC0000',
  lightBlue:  'FFB8D4E8',
  lightGreen: 'FFB8D4B8',
  lightPink:  'FFEDBBBB',
  lightPurple:'FFD5C8E8',
  tan:        'FFD4B896',
  white:      'FFFFFFFF',
  darkGray:   'FF3C3C3C',
  medGray:    'FFD0D0D0',
  lightYellow:'FFFFF3CD',
  headerRow:  'FF2D2D2D',
  totalBg:    'FF1B3D6B',
}

// Collaborator colors (match the screenshot pastel chips)
const COLLAB_COLORS: Record<string, string> = {
  Jaime:    'FFFFFFFF',
  'Laura G':'FFFFF9C4',
  Nata:     'FFE1F5FE',
  'Nico P': 'FFE8F5E9',
  Nico:     'FFFCE4EC',
  Nicolas:  'FFFCE4EC',
  'Andres S':'FFE8F5E9',
  Angie:    'FFF3E5F5',
  Sebas:    'FFFFE0B2',
  Carlos:   'FFE3F2FD',
  'Dani S': 'FFEDE7F6',
  'Andrés C':'FFFFE8E8',
  Brausin:  'FFD4B896',
  NA:       'FFD4B896',
}

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } }
}
function font(opts: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> {
  return { size: 10, ...opts }
}
function border(cell: ExcelJS.Cell) {
  cell.border = {
    top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
    left:   { style: 'thin', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    right:  { style: 'thin', color: { argb: 'FFCCCCCC' } },
  }
}
function center(cell: ExcelJS.Cell) {
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false }
}

export function getWeeksInMonth(year: number, month: number): TrafficWeek[] {
  const weeks: TrafficWeek[] = []
  const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const abbr = monthNames[month - 1]
  let weekNum = 1
  const firstDay = new Date(year, month - 1, 1)
  let current = startOfWeek(firstDay, { weekStartsOn: 1 })

  while (true) {
    const weekStart = current
    const weekEnd = addDays(current, 4)
    if (weekStart.getMonth() === month - 1 || weekEnd.getMonth() === month - 1) {
      weeks.push({
        weekLabel: `${abbr} S${weekNum}`,
        weekStart: format(weekStart, 'yyyy-MM-dd'),
        weekEnd: format(weekEnd, 'yyyy-MM-dd'),
        entries: [],
      })
      weekNum++
    }
    current = addDays(current, 7)
    if (weekStart.getMonth() > month - 1 || weekNum > 6) break
  }
  return weeks
}

export async function generateTrafficExcel(
  entries: TrafficEntry[],
  weekData: TrafficWeek,
  projectName: string,
  copyTeam: string[] = ['Jaime', 'Laura G', 'Nata', 'Nico P'],
  graphicTeam: string[] = ['Nico', 'Carlos', 'Andres S', 'Brausin'],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Amarilo Automation'
  workbook.created = new Date()

  const ws = workbook.addWorksheet(weekData.weekLabel, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  })

  // Extract month/week from label e.g. "Jun S1"
  const labelParts = weekData.weekLabel.split(' ')
  const monthLabel = labelParts[0]?.toUpperCase() ?? ''
  const weekNum = labelParts[1] ?? 'S1'

  const weekStartDate = new Date(weekData.weekStart)
  const days = DAYS_OF_WEEK

  // ── Column widths ──────────────────────────────────────────────────────────
  // A=month label, B=category, C=name, D-H=days, I=Total
  ws.columns = [
    { key: 'month',       width: 9  }, // A
    { key: 'category',    width: 12 }, // B
    { key: 'name',        width: 14 }, // C
    ...days.map(() => ({ width: 12 })), // D-H
    { key: 'total',       width: 10 }, // I
  ]

  // ── ROW 1: month/week label + day headers ──────────────────────────────────
  const r1 = ws.getRow(1)
  r1.height = 36

  // A1:A2 = Month label (merged, big)
  ws.mergeCells('A1:A2')
  const monthCell = ws.getCell('A1')
  monthCell.value = monthLabel
  monthCell.font = font({ size: 28, bold: true, color: { argb: C.redLabel } })
  monthCell.alignment = { horizontal: 'center', vertical: 'middle' }
  monthCell.fill = fill(C.yellow)

  // B1:C1 = week label
  ws.mergeCells('B1:C1')
  const weekCell = ws.getCell('B1')
  weekCell.value = weekNum
  weekCell.font = font({ size: 20, bold: true, color: { argb: C.redLabel } })
  weekCell.alignment = { horizontal: 'center', vertical: 'middle' }
  weekCell.fill = fill(C.yellow)

  // Day headers D1:H1
  days.forEach((day, i) => {
    const col = 4 + i // D=4
    const date = addDays(weekStartDate, i)
    const cell = r1.getCell(col)
    cell.value = `${day.toUpperCase().slice(0, 2)} ${format(date, 'd')}\n${format(date, 'MMM', { locale: es }).toUpperCase()}`
    cell.font = font({ bold: true, color: { argb: C.white } })
    cell.fill = fill(C.navy)
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    border(cell)
  })

  // I1 = TOTAL header
  const totalH = r1.getCell(9)
  totalH.value = 'TOTAL'
  totalH.font = font({ bold: true, color: { argb: C.white } })
  totalH.fill = fill(C.navy)
  center(totalH)
  border(totalH)

  // ── ROW 2: Sub-week label cell ─────────────────────────────────────────────
  const r2 = ws.getRow(2)
  r2.height = 18
  // B2:C2
  ws.mergeCells('B2:C2')
  const subWeek = ws.getCell('B2')
  subWeek.value = weekData.weekLabel
  subWeek.font = font({ bold: true })
  subWeek.fill = fill(C.yellow)
  subWeek.alignment = { horizontal: 'center', vertical: 'middle' }

  // Day date numbers row
  days.forEach((_, i) => {
    const cell = r2.getCell(4 + i)
    cell.fill = fill(C.lightBlue)
    border(cell)
  })
  ws.getCell('I2').fill = fill(C.medGray)
  border(ws.getCell('I2'))

  // ── SUMMARY SECTION ────────────────────────────────────────────────────────
  let row = 3

  // Copy header row
  {
    const r = ws.getRow(row); r.height = 18
    ws.mergeCells(row, 2, row, 3)
    const c = r.getCell(2)
    c.value = 'Copy'
    c.font = font({ bold: true, color: { argb: C.white } })
    c.fill = fill(C.navy)
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    border(c)
    days.forEach((_, i) => { border(r.getCell(4 + i)); r.getCell(4 + i).fill = fill(C.lightBlue) })
    const totCell = r.getCell(9); totCell.fill = fill(C.lightBlue); border(totCell)
    row++
  }

  // Copy member rows
  for (const member of copyTeam) {
    const r = ws.getRow(row); r.height = 18
    const nameCell = r.getCell(3)
    nameCell.value = member
    nameCell.font = font({ bold: true })
    nameCell.fill = fill(COLLAB_COLORS[member] ?? C.white)
    border(nameCell)

    // B = empty category
    r.getCell(2).fill = fill(C.lightYellow)
    border(r.getCell(2))

    let memberTotal = 0
    days.forEach((day, i) => {
      const count = entries.filter((e) => e.dayOfWeek === day && e.copyName === member)
        .reduce((s, e) => s + (e.numTexts || 0), 0)
      memberTotal += count
      const cell = r.getCell(4 + i)
      cell.value = count || ''
      cell.font = font({ bold: count > 0 })
      cell.fill = fill(count > 0 ? C.lightBlue : C.white)
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      border(cell)
    })
    const totC = r.getCell(9)
    totC.value = memberTotal || ''
    totC.font = font({ bold: true })
    totC.fill = fill(memberTotal > 0 ? C.lightBlue : C.medGray)
    center(totC); border(totC)
    row++
  }

  // Graphic header row
  {
    const r = ws.getRow(row); r.height = 18
    ws.mergeCells(row, 2, row, 3)
    const c = r.getCell(2)
    c.value = 'Gráfico'
    c.font = font({ bold: true, color: { argb: C.white } })
    c.fill = fill(C.navy)
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    border(c)
    days.forEach((_, i) => { border(r.getCell(4 + i)); r.getCell(4 + i).fill = fill(C.lightGreen) })
    ws.getCell(row, 9).fill = fill(C.lightGreen); border(ws.getCell(row, 9))
    row++
  }

  // Graphic member rows
  for (const member of graphicTeam) {
    const r = ws.getRow(row); r.height = 18
    const nameCell = r.getCell(3)
    nameCell.value = member
    nameCell.font = font({ bold: true })
    nameCell.fill = fill(COLLAB_COLORS[member] ?? C.white)
    border(nameCell)
    r.getCell(2).fill = fill(C.lightYellow); border(r.getCell(2))

    let memberTotal = 0
    days.forEach((day, i) => {
      const count = entries.filter((e) => e.dayOfWeek === day && e.graphicName === member)
        .reduce((s, e) => s + (e.numGraphics || 0), 0)
      memberTotal += count
      const cell = r.getCell(4 + i)
      cell.value = count || ''
      cell.font = font({ bold: count > 0 })
      cell.fill = fill(count > 0 ? C.lightGreen : C.white)
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      border(cell)
    })
    const totC = r.getCell(9)
    totC.value = memberTotal || ''
    totC.font = font({ bold: true })
    totC.fill = fill(memberTotal > 0 ? C.lightGreen : C.medGray)
    center(totC); border(totC)
    row++
  }

  // Total row
  {
    const r = ws.getRow(row); r.height = 20
    ws.mergeCells(row, 1, row, 3)
    const totLabel = r.getCell(1)
    totLabel.value = 'Total'
    totLabel.font = font({ bold: true, color: { argb: C.white } })
    totLabel.fill = fill(C.totalBg)
    totLabel.alignment = { horizontal: 'center', vertical: 'middle' }

    let grandTotal = 0
    days.forEach((day, i) => {
      const dayTotal = entries.filter((e) => e.dayOfWeek === day)
        .reduce((s, e) => s + (e.numTexts || 0) + (e.numGraphics || 0), 0)
      grandTotal += dayTotal
      const cell = r.getCell(4 + i)
      cell.value = dayTotal
      cell.font = font({ bold: true, color: { argb: C.white } })
      cell.fill = fill(C.totalBg)
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      border(cell)
    })
    const totC = r.getCell(9)
    totC.value = grandTotal
    totC.font = font({ bold: true, color: { argb: C.white } })
    totC.fill = fill(C.totalBg)
    center(totC); border(totC)
    row++
  }

  // ── Empty row ──────────────────────────────────────────────────────────────
  row++

  // ── DETAIL TABLE HEADER ────────────────────────────────────────────────────
  // Widen columns for detail table: redefine from column A
  // A=Día, B=Campaña, C=Ciudad, D=Requerimiento, E=#Textos, F=Copy, G=#Gráficas, H=Gráfico, I=Estado
  const detailCols: { label: string; width: number }[] = [
    { label: '',               width: 9  },
    { label: 'Campaña',        width: 20 },
    { label: 'Ciudad',         width: 14 },
    { label: 'Requerimiento',  width: 38 },
    { label: '# Textos',       width: 8  },
    { label: 'Copy',           width: 14 },
    { label: '# Gráficas',     width: 10 },
    { label: 'Gráfico',        width: 14 },
    { label: 'Estado',         width: 14 },
  ]
  detailCols.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width
  })

  const headerRow = ws.getRow(row); headerRow.height = 22
  detailCols.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.label
    cell.font = font({ bold: true, color: { argb: C.white } })
    cell.fill = fill(C.headerRow)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    border(cell)
  })
  row++

  const STATUS_LABELS: Record<string, string> = {
    pending:     'Pendiente',
    in_progress: 'En Progreso',
    review:      'En Revisión',
    done:        'Entregado',
  }

  // ── Detail rows grouped by day ─────────────────────────────────────────────
  for (const day of days) {
    const dayEntries = entries.filter((e) => e.dayOfWeek === day)
    const EMPTY_ROWS_PER_DAY = 10
    const rowCount = Math.max(dayEntries.length, EMPTY_ROWS_PER_DAY)

    for (let i = 0; i < rowCount; i++) {
      const entry = dayEntries[i]
      const r = ws.getRow(row); r.height = 18

      // Day label only on first row
      const dayCell = r.getCell(1)
      if (i === 0) {
        dayCell.value = day
        dayCell.font = font({ bold: true })
        dayCell.fill = fill(C.yellow)
      } else {
        dayCell.fill = fill(C.white)
      }
      border(dayCell)

      if (entry) {
        r.getCell(2).value = entry.campaign || ''
        r.getCell(3).value = (entry as TrafficEntry & { city?: string }).city || ''
        r.getCell(4).value = entry.requirement || ''
        r.getCell(5).value = entry.numTexts || ''
        r.getCell(6).value = entry.copyName || 'NA'
        r.getCell(7).value = entry.numGraphics || ''
        r.getCell(8).value = entry.graphicName || 'NA'
        r.getCell(9).value = STATUS_LABELS[entry.status] || entry.status || 'Pendiente'

        // Color the copy/graphic name cells
        const copyBg = COLLAB_COLORS[entry.copyName ?? ''] ?? C.white
        const gfxBg  = COLLAB_COLORS[entry.graphicName ?? ''] ?? C.white
        r.getCell(6).fill = fill(entry.copyName && entry.copyName !== 'NA' ? copyBg : C.tan)
        r.getCell(8).fill = fill(entry.graphicName && entry.graphicName !== 'NA' ? gfxBg : C.tan)
      }

      for (let c = 1; c <= 9; c++) {
        const cell = r.getCell(c)
        if (c !== 1) cell.fill = cell.fill ?? fill(C.white)
        cell.alignment = { horizontal: c >= 5 ? 'center' : 'left', vertical: 'middle' }
        border(cell)
      }
      row++
    }

    // Dark separator between days
    const sep = ws.getRow(row); sep.height = 6
    for (let c = 1; c <= 9; c++) sep.getCell(c).fill = fill(C.darkGray)
    row++
  }

  const buf = await workbook.xlsx.writeBuffer()
  return Buffer.from(buf)
}
