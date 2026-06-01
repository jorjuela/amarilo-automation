'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function GenerateJiraButton({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleGenerate() {
    setLoading(true)
    try {
      const res = await fetch('/api/jira', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      if (res.ok) {
        router.push(`/dashboard/jira?projectId=${projectId}`)
      } else {
        const data = await res.json()
        alert(data.error || 'Error generando estructura Jira')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={loading}
      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-60"
      style={{ background: 'var(--amarilo-navy)' }}
    >
      {loading ? 'Generando...' : 'Generar Jira'}
    </button>
  )
}
