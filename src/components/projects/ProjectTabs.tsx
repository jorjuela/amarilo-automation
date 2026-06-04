'use client'

import Link from 'next/link'

const TABS = [
  { key: 'overview', label: '📋 Resumen' },
  { key: 'traffic',  label: '📅 Tráfico' },
  { key: 'jira',     label: '🎯 Jira' },
]

export default function ProjectTabs({ projectId, activeTab }: { projectId: string; activeTab: string }) {
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/dashboard/projects/${projectId}?tab=${t.key}`}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            activeTab === t.key
              ? 'bg-white border border-b-white border-gray-200 text-blue-700 -mb-px'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
