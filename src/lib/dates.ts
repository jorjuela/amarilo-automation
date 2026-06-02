import { startOfWeek, addDays, format } from 'date-fns'
import type { TrafficWeek } from '@/types'

const MONTH_ABBR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export function getWeeksInMonth(year: number, month: number): TrafficWeek[] {
  const weeks: TrafficWeek[] = []
  const monthAbbr = MONTH_ABBR[month - 1]
  let weekNum = 1
  let current = startOfWeek(new Date(year, month - 1, 1), { weekStartsOn: 1 })

  while (weekNum <= 5) {
    const weekEnd = addDays(current, 4)
    if (current.getMonth() === month - 1 || weekEnd.getMonth() === month - 1) {
      weeks.push({
        weekLabel: `${monthAbbr} S${weekNum}`,
        weekStart: format(current, 'yyyy-MM-dd'),
        weekEnd: format(weekEnd, 'yyyy-MM-dd'),
        entries: [],
      })
      weekNum++
    }
    current = addDays(current, 7)
    if (current.getMonth() > month - 1 && current.getFullYear() >= year) break
  }

  return weeks
}
