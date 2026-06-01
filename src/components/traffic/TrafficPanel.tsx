'use client'

import { useState, useEffect } from 'react'
import { TEAM_MEMBERS, DAYS_OF_WEEK } from '@/types'
import type { TrafficEntry } from '@/types'
import { getWeeksInMonth } from '@/lib/excel/traffic'
import { format, addDays } from 'date-fns'

interface Project {
  id: string; name: string; city: string; stage: string
  torres: { name: string }[]
}

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const STATUS_OPTIONS = ['pending', 'in_progress', 'review', 'done']
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente', in_progress: 'En progreso', review: 'En revisión', done: 'Listo',
}
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  review: 'bg-yellow-100 text-yellow-700',
  done: 'bg-green-100 text-green-700',
}

export default function TrafficPanel({ projects }: { projects: Project[] }) {
  const now = new Date()
  const [selectedProject, setSelectedProject] = useState(projects[0]?.id || '')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedWeek, setSelectedWeek] = useState(0)
  const [entries, setEntries] = useState<TrafficEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeDay, setActiveDay] = useState(DAYS_OF_WEEK[0])

  const weeks = getWeeksInMonth(year, month)
  const currentWeek = weeks[selectedWeek] || weeks[0]

  useEffect(() => {
    if (currentWeek && selectedProject) {
      fetchEntries()
    }
  }, [currentWeek?.weekLabel, selectedProject])

  async function fetchEntries() {
    if (!currentWeek) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/traffic?projectId=${selectedProject}&weekLabel=${encodeURIComponent(currentWeek.weekLabel)}`
      )
      const data = await res.json()
      setEntries(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  function getEntry(day: string, index: number): TrafficEntry | undefined {
    return entries.filter((e) => e.dayOfWeek === day)[index]
  }

  function setEntry(day: string, index: number, field: keyof TrafficEntry, value: string | number) {
    setEntries((prev) => {
      const dayEntries = prev.filter((e) => e.dayOfWeek === day)
      let target = dayEntries[index]

      if (!target) {
        // Create new entry
        const weekDate = new Date(currentWeek.weekStart)
        const dayOffset = DAYS_OF_WEEK.indexOf(day)
        const entryDate = addDays(weekDate, dayOffset)

        target = {
          weekStart: currentWeek.weekStart,
          weekEnd: currentWeek.weekEnd,
          weekLabel: currentWeek.weekLabel,
          dayOfWeek: day,
          campaign: '',
          pm: '',
          requirement: '',
          numTexts: 0,
          numGraphics: 0,
          status: 'pending',
          projectId: selectedProject,
        }
        return [...prev, { ...target, [field]: value }]
      }

      return prev.map((e) => {
        if (e === target) return { ...e, [field]: value }
        return e
      })
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Upsert all entries
      const toSave = entries.filter((e) => e.campaign || e.requirement)
      for (const entry of toSave) {
        if (entry.id) {
          await fetch('/api/traffic', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          })
        } else {
          const res = await fetch('/api/traffic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          })
          const saved = await res.json()
          setEntries((prev) => prev.map((e) => (e === entry ? { ...e, id: saved.id } : e)))
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleExport() {
    if (!currentWeek) return
    const url = `/api/traffic/export?projectId=${selectedProject}&weekLabel=${encodeURIComponent(currentWeek.weekLabel)}&weekStart=${currentWeek.weekStart}&weekEnd=${currentWeek.weekEnd}`
    window.open(url, '_blank')
  }

  const project = projects.find((p) => p.id === selectedProject)
  const dayEntries = entries.filter((e) => e.dayOfWeek === activeDay)
  // Always show at least 8 rows
  const rows = Math.max(dayEntries.length + 1, 8)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Proyecto</label>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.city}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Año</label>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
          >
            {[2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mes</label>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
          >
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Semana</label>
          <div className="flex gap-1">
            {weeks.map((w, i) => (
              <button
                key={w.weekLabel}
                onClick={() => setSelectedWeek(i)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  i === selectedWeek
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={i === selectedWeek ? { background: 'var(--amarilo-navy)' } : {}}
              >
                {w.weekLabel}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-1.5 text-white rounded-lg text-sm font-medium hover:opacity-90"
            style={{ background: 'var(--amarilo-yellow)', color: '#1B3D6B' }}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Summary grid (team member counts) */}
      {currentWeek && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <span className="font-semibold text-gray-800 text-sm">{currentWeek.weekLabel}</span>
              <span className="text-gray-400 text-xs ml-2">
                {format(new Date(currentWeek.weekStart), 'd MMM')} – {format(new Date(currentWeek.weekEnd), 'd MMM yyyy')}
              </span>
            </div>
            <span className="text-xs text-gray-400 font-mono">D I C S</span>
          </div>

          {/* Summary table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--amarilo-navy)' }}>
                  <th className="px-3 py-2 text-left text-white font-semibold w-24">Área</th>
                  <th className="px-3 py-2 text-left text-white font-semibold w-28">Nombre</th>
                  {DAYS_OF_WEEK.map((d) => (
                    <th key={d} className="px-3 py-2 text-center text-white font-semibold">{d.slice(0,3)}</th>
                  ))}
                  <th className="px-3 py-2 text-center text-white font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {/* Copy */}
                <tr>
                  <td
                    rowSpan={TEAM_MEMBERS.copy.length + 1}
                    className="px-3 py-2 font-bold text-xs border-r border-gray-100 align-top"
                    style={{ background: '#FFFDE7' }}
                  >
                    Copy
                  </td>
                </tr>
                {TEAM_MEMBERS.copy.map((member) => (
                  <MemberRow key={member} member={member} entries={entries} fill="#FFFDE7" />
                ))}
                {/* Graphic */}
                <tr>
                  <td
                    rowSpan={TEAM_MEMBERS.graphic.length + 1}
                    className="px-3 py-2 font-bold text-xs border-r border-gray-100 align-top"
                    style={{ background: '#E1F5FE' }}
                  >
                    Gráfico
                  </td>
                </tr>
                {TEAM_MEMBERS.graphic.map((member) => (
                  <MemberRow key={member} member={member} entries={entries} fill="#E1F5FE" />
                ))}
                {/* Strategist */}
                {TEAM_MEMBERS.strategist.map((member) => (
                  <tr key={member} style={{ background: '#E8F5E9' }}>
                    <td className="px-3 py-2 font-bold text-xs border-r border-gray-100">Strategist</td>
                    <td className="px-3 py-2 text-gray-700">{member}</td>
                    {DAYS_OF_WEEK.map((d) => (
                      <td key={d} className="px-3 py-2 text-center text-gray-500">0</td>
                    ))}
                    <td className="px-3 py-2 text-center font-bold text-gray-700">0</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Day tabs + task table */}
      <div className="card overflow-hidden">
        <div className="flex border-b border-gray-100">
          {DAYS_OF_WEEK.map((day) => (
            <button
              key={day}
              onClick={() => setActiveDay(day)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeDay === day
                  ? 'border-b-2 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              style={activeDay === day ? { borderColor: 'var(--amarilo-yellow)' } : {}}
            >
              {day}
              {entries.filter((e) => e.dayOfWeek === day && e.campaign).length > 0 && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
              )}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--amarilo-navy)' }}>
                <th className="px-3 py-2 text-left text-white font-semibold">Campaña</th>
                <th className="px-3 py-2 text-left text-white font-semibold">PM</th>
                <th className="px-3 py-2 text-left text-white font-semibold">Requerimiento</th>
                <th className="px-3 py-2 text-center text-white font-semibold">#Textos</th>
                <th className="px-3 py-2 text-left text-white font-semibold">Copy</th>
                <th className="px-3 py-2 text-center text-white font-semibold">#Gráficas</th>
                <th className="px-3 py-2 text-left text-white font-semibold">Gráfico</th>
                <th className="px-3 py-2 text-left text-white font-semibold">Estado</th>
                <th className="px-3 py-2 text-left text-white font-semibold">Jira</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, idx) => {
                const entry = getEntry(activeDay, idx)
                return (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-2 py-1">
                      <input
                        value={entry?.campaign || ''}
                        onChange={(e) => setEntry(activeDay, idx, 'campaign', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5"
                        placeholder={idx === 0 ? `${project?.name || ''}` : ''}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={entry?.pm || ''}
                        onChange={(e) => setEntry(activeDay, idx, 'pm', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs text-gray-700 focus:outline-none"
                      >
                        <option value="">-</option>
                        {['Catherine Sanchez', 'Juan Sebastian', 'Jessica Herrera', 'Nicolas Sanchez'].map((pm) => (
                          <option key={pm}>{pm}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={entry?.requirement || ''}
                        onChange={(e) => setEntry(activeDay, idx, 'requirement', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5"
                        placeholder="Ej: Desarrollo material META..."
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={entry?.numTexts || ''}
                        onChange={(e) => setEntry(activeDay, idx, 'numTexts', parseInt(e.target.value) || 0)}
                        className="w-14 border-0 bg-transparent text-xs text-center text-gray-700 focus:outline-none"
                        min={0}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={entry?.copyName || ''}
                        onChange={(e) => setEntry(activeDay, idx, 'copyName', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs text-gray-700 focus:outline-none"
                      >
                        <option value="">-</option>
                        {TEAM_MEMBERS.copy.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={entry?.numGraphics || ''}
                        onChange={(e) => setEntry(activeDay, idx, 'numGraphics', parseInt(e.target.value) || 0)}
                        className="w-14 border-0 bg-transparent text-xs text-center text-gray-700 focus:outline-none"
                        min={0}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={entry?.graphicName || ''}
                        onChange={(e) => setEntry(activeDay, idx, 'graphicName', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs text-gray-700 focus:outline-none"
                      >
                        <option value="">-</option>
                        {TEAM_MEMBERS.graphic.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={entry?.status || 'pending'}
                        onChange={(e) => setEntry(activeDay, idx, 'status', e.target.value)}
                        className={`w-full text-xs rounded px-1 py-0.5 border-0 focus:outline-none ${STATUS_COLORS[entry?.status || 'pending']}`}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={entry?.jiraTicket || ''}
                        onChange={(e) => setEntry(activeDay, idx, 'jiraTicket', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs text-gray-700 focus:outline-none font-mono"
                        placeholder="AMARILO-XXX"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MemberRow({ member, entries, fill }: { member: string; entries: TrafficEntry[]; fill: string }) {
  const dayTotals = DAYS_OF_WEEK.map((d) => {
    const dayEntries = entries.filter((e) => e.dayOfWeek === d)
    const memberEntries = dayEntries.filter(
      (e) => e.copyName === member || e.graphicName === member
    )
    return memberEntries.reduce(
      (sum, e) => sum + (e.copyName === member ? (e.numTexts || 0) : (e.numGraphics || 0)), 0
    )
  })
  const total = dayTotals.reduce((s, v) => s + v, 0)

  return (
    <tr style={{ background: fill }}>
      <td className="px-3 py-1.5 text-gray-700 border-r border-gray-100">{member}</td>
      {dayTotals.map((v, i) => (
        <td key={i} className="px-3 py-1.5 text-center text-gray-700 font-medium">{v}</td>
      ))}
      <td className="px-3 py-1.5 text-center font-bold text-gray-800">{total}</td>
    </tr>
  )
}
