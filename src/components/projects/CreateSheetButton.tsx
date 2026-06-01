'use client'

import { useState } from 'react'

export default function CreateSheetButton({
  projectId, hasSheet, sheetUrl,
}: {
  projectId: string; hasSheet: boolean; sheetUrl: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState(sheetUrl)

  async function handleCreate() {
    setLoading(true)
    try {
      const res = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (data.url) {
        setUrl(data.url)
        window.open(data.url, '_blank')
      } else {
        alert(data.error || 'Error creando hoja')
      }
    } finally {
      setLoading(false)
    }
  }

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
      >
        Abrir Google Sheet
      </a>
    )
  }

  return (
    <button
      onClick={handleCreate}
      disabled={loading}
      className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-60"
    >
      {loading ? 'Creando...' : 'Crear Google Sheet'}
    </button>
  )
}
