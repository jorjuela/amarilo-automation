'use client'

import { useState } from 'react'

interface SettingsData {
  gmail?: { clientId?: string; clientSecret?: string; refreshToken?: string; email?: string }
  googleDrive?: { clientEmail?: string; privateKey?: string; folderId?: string }
  jira?: { boardUrl?: string; projectKey?: string }
  emailSubjectPattern?: string
  cronEnabled?: boolean
}

export default function SettingsForm({ initialSettings }: { initialSettings: SettingsData }) {
  const [settings, setSettings] = useState<SettingsData>({
    gmail: { clientId: '', clientSecret: '', refreshToken: '', email: '', ...initialSettings.gmail },
    googleDrive: { clientEmail: '', privateKey: '', folderId: '', ...initialSettings.googleDrive },
    jira: {
      boardUrl: 'https://brandigital.jira.com/jira/software/c/projects/AMARILO/boards/989/timeline',
      projectKey: 'AMARILO',
      ...initialSettings.jira,
    },
    emailSubjectPattern: initialSettings.emailSubjectPattern || 'AMARILO |',
    cronEnabled: initialSettings.cronEnabled ?? false,
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  function update(section: keyof SettingsData, key: string, value: string | boolean) {
    setSettings((prev) => ({
      ...prev,
      [section]: typeof prev[section] === 'object'
        ? { ...(prev[section] as object), [key]: value }
        : value,
    }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  async function handleTestEmail() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/cron/email')
      const data = await res.json()
      setTestResult(JSON.stringify(data, null, 2))
    } catch (err) {
      setTestResult(`Error: ${err}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Gmail */}
      <Section
        title="Gmail API"
        desc="Para monitorear emails con briefs de proyectos"
        icon="📧"
        guide={
          <div className="text-xs text-gray-500 space-y-1 bg-gray-50 rounded-lg p-3 mt-2">
            <p className="font-medium text-gray-700">Cómo configurar:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Ve a Google Cloud Console → APIs & Services → Credentials</li>
              <li>Crea un OAuth 2.0 Client ID (tipo: Desktop App)</li>
              <li>Usa el OAuth Playground para obtener el refresh token con scope gmail.readonly</li>
              <li>Activa Gmail API en tu proyecto</li>
            </ol>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Email de la cuenta"
            value={settings.gmail?.email || ''}
            onChange={(v) => update('gmail', 'email', v)}
            placeholder="tu@gmail.com"
          />
          <Field
            label="Client ID"
            value={settings.gmail?.clientId || ''}
            onChange={(v) => update('gmail', 'clientId', v)}
            placeholder="xxxxx.apps.googleusercontent.com"
          />
          <Field
            label="Client Secret"
            value={settings.gmail?.clientSecret || ''}
            onChange={(v) => update('gmail', 'clientSecret', v)}
            type="password"
            placeholder="GOCSPX-..."
          />
          <Field
            label="Refresh Token"
            value={settings.gmail?.refreshToken || ''}
            onChange={(v) => update('gmail', 'refreshToken', v)}
            type="password"
            placeholder={settings.gmail?.refreshToken === '***saved***' ? '***saved***' : '1//...'}
          />
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Patrón de subject esperado</label>
          <input
            value={settings.emailSubjectPattern || ''}
            onChange={(e) => setSettings({ ...settings, emailSubjectPattern: e.target.value })}
            placeholder="AMARILO |"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 font-mono"
          />
        </div>
      </Section>

      {/* Google Drive */}
      <Section
        title="Google Drive / Sheets API"
        desc="Para crear la hoja de cálculo Amarilo-cliente automáticamente"
        icon="📊"
        guide={
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 mt-2">
            <p className="font-medium text-gray-700 mb-1">Usa una Service Account:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Ve a Google Cloud Console → IAM & Admin → Service Accounts</li>
              <li>Crea una service account y descarga el JSON</li>
              <li>Comparte la carpeta de Drive con el email de la service account</li>
              <li>Activa Google Sheets API y Google Drive API</li>
            </ol>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Client Email (Service Account)"
            value={settings.googleDrive?.clientEmail || ''}
            onChange={(v) => update('googleDrive', 'clientEmail', v)}
            placeholder="nombre@proyecto.iam.gserviceaccount.com"
          />
          <Field
            label="ID de la carpeta en Drive"
            value={settings.googleDrive?.folderId || ''}
            onChange={(v) => update('googleDrive', 'folderId', v)}
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs..."
          />
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Private Key (del JSON de Service Account)</label>
            <textarea
              value={settings.googleDrive?.privateKey || ''}
              onChange={(e) => update('googleDrive', 'privateKey', e.target.value)}
              rows={3}
              placeholder={settings.googleDrive?.privateKey === '***saved***' ? '***saved***' : '-----BEGIN RSA PRIVATE KEY-----\n...'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
        </div>
      </Section>

      {/* Jira */}
      <Section title="Jira" desc="Configuración del tablero para la generación de estructura" icon="⚡">
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="URL del tablero"
            value={settings.jira?.boardUrl || ''}
            onChange={(v) => update('jira', 'boardUrl', v)}
            placeholder="https://brandigital.jira.com/..."
          />
          <Field
            label="Project Key"
            value={settings.jira?.projectKey || ''}
            onChange={(v) => update('jira', 'projectKey', v)}
            placeholder="AMARILO"
          />
        </div>
      </Section>

      {/* Cron Job */}
      <Section title="Monitor Automático" desc="El cron job revisa tu Gmail cada 15 minutos" icon="🤖">
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.cronEnabled || false}
              onChange={(e) => setSettings({ ...settings, cronEnabled: e.target.checked })}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors ${settings.cronEnabled ? 'bg-blue-600' : 'bg-gray-200'}`}>
              <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ml-0.5 ${settings.cronEnabled ? 'translate-x-5' : ''}`} />
            </div>
          </label>
          <span className="text-sm text-gray-700">
            {settings.cronEnabled ? 'Activado' : 'Desactivado'}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Para activar el cron automático en producción, configura la variable{' '}
          <code className="bg-gray-100 px-1 rounded">CRON_SECRET</code> y agrega la URL{' '}
          <code className="bg-gray-100 px-1 rounded">/api/cron/email</code> a tu servicio de cron (Vercel Cron, cron-job.org, etc.)
        </p>
        <button
          type="button"
          onClick={handleTestEmail}
          disabled={testing}
          className="mt-3 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-60"
        >
          {testing ? 'Ejecutando...' : 'Ejecutar manualmente ahora'}
        </button>
        {testResult && (
          <pre className="mt-2 p-3 bg-gray-900 text-green-400 text-xs rounded-lg overflow-x-auto">{testResult}</pre>
        )}
      </Section>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-all"
          style={{ background: 'var(--amarilo-navy)' }}
        >
          {saving ? 'Guardando...' : 'Guardar Configuración'}
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium">✓ Guardado correctamente</span>
        )}
      </div>
    </form>
  )
}

function Section({
  title, desc, icon, children, guide,
}: {
  title: string; desc: string; icon: string; children: React.ReactNode; guide?: React.ReactNode
}) {
  return (
    <div className="card p-6">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-2xl">{icon}</span>
        <div>
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <p className="text-sm text-gray-400">{desc}</p>
        </div>
      </div>
      {guide}
      <div className={guide ? 'mt-4' : ''}>{children}</div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
      />
    </div>
  )
}
