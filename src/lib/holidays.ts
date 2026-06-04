// Colombia public holidays (Ley 51/1983 + Ley 270/1996)
// Fixed holidays stay on the date; "trasladables" move to next Monday if not already Monday.

const FIXED: [string, string][] = [
  // [MM-DD, name]
  ['01-01', 'Año Nuevo'],
  ['05-01', 'Día del Trabajo'],
  ['07-20', 'Independencia de Colombia'],
  ['08-07', 'Batalla de Boyacá'],
  ['12-08', 'Inmaculada Concepción'],
  ['12-25', 'Navidad'],
]

// Movable holidays (Easter-based) per year — precomputed 2025-2028
const MOVABLE: Record<number, string[]> = {
  2025: [
    '2025-01-06', // Reyes Magos
    '2025-03-24', // San José
    '2025-04-17', // Jueves Santo
    '2025-04-18', // Viernes Santo
    '2025-05-01', // Día del Trabajo (fixed but in list for completeness)
    '2025-06-02', // Ascensión
    '2025-06-23', // Corpus Christi
    '2025-06-30', // Sagrado Corazón
    '2025-07-07', // San Pedro y San Pablo
    '2025-08-18', // Asunción de la Virgen
    '2025-10-13', // Día de la Raza
    '2025-11-03', // Todos los Santos
    '2025-11-17', // Independencia de Cartagena
  ],
  2026: [
    '2026-01-12', // Reyes Magos
    '2026-03-23', // San José
    '2026-04-02', // Jueves Santo
    '2026-04-03', // Viernes Santo
    '2026-06-01', // Ascensión
    '2026-06-22', // Corpus Christi
    '2026-06-29', // Sagrado Corazón
    '2026-07-06', // San Pedro y San Pablo
    '2026-08-17', // Asunción de la Virgen
    '2026-10-12', // Día de la Raza
    '2026-11-02', // Todos los Santos
    '2026-11-16', // Independencia de Cartagena
  ],
  2027: [
    '2027-01-11', // Reyes Magos
    '2027-03-22', // San José
    '2027-03-25', // Jueves Santo
    '2027-03-26', // Viernes Santo
    '2027-05-24', // Ascensión
    '2027-06-14', // Corpus Christi
    '2027-06-21', // Sagrado Corazón
    '2027-07-05', // San Pedro y San Pablo
    '2027-08-16', // Asunción de la Virgen
    '2027-10-18', // Día de la Raza
    '2027-11-01', // Todos los Santos
    '2027-11-15', // Independencia de Cartagena
  ],
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function buildHolidaySet(year: number): Set<string> {
  const set = new Set<string>()

  // Fixed
  for (const [mmdd] of FIXED) {
    set.add(`${year}-${mmdd}`)
  }

  // Movable
  for (const d of MOVABLE[year] ?? []) {
    set.add(d)
  }

  return set
}

const _cache: Record<number, Set<string>> = {}

function getHolidaysForYear(year: number): Set<string> {
  if (!_cache[year]) _cache[year] = buildHolidaySet(year)
  return _cache[year]
}

export function isHoliday(date: Date): boolean {
  const key = toDateKey(date)
  const year = date.getFullYear()
  return getHolidaysForYear(year).has(key)
}

export function isWorkingDay(date: Date): boolean {
  const dow = date.getDay() // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false
  return !isHoliday(date)
}

export function nextWorkingDay(from: Date): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + 1)
  while (!isWorkingDay(d)) d.setDate(d.getDate() + 1)
  return d
}

export function addWorkingDays(from: Date, days: number): Date {
  let d = new Date(from)
  let added = 0
  while (added < days) {
    d = nextWorkingDay(d)
    added++
  }
  return d
}

export function getWorkingDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = []
  const d = new Date(start)
  while (d <= end) {
    if (isWorkingDay(d)) days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

export const DAY_NAMES_ES: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
}
