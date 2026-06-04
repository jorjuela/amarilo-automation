'use client'

import { useState, useEffect } from 'react'

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
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagResult, setDiagResult] = useState<string | null>(null)
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [oauthMessage, setOauthMessage] = useState('')

  // Read OAuth callback result from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const success = params.get('success')
    const error = params.get('error')
    if (success === 'gmail-authorized') {
      setOauthStatus('success')
      setOauthMessage('Gmail autorizado correctamente. El refresh token fue guardado.')
      // Reload settings to show the saved email
      fetch('/api/settings').then(r => r.json()).then(data => {
        if (data.gmail?.email) {
          setSettings(prev => ({ ...prev, gmail: { ...prev.gmail, email: data.gmail.email, refreshToken: '***saved***' } }))
        }
      })
      // Clean up URL
      window.history.replaceState({}, '', '/dashboard/settings')
    } else if (error) {
      setOauthStatus('error')
      setOauthMessage(decodeURIComponent(error))
    }
  }, [])

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

  async function handleDiagnose() {
    setDiagnosing(true)
    setDiagResult(null)
    try {
      const res = await fetch('/api/cron/debug')
      const data = await res.json()
      if (data.error?.includes('invalid_grant') || data.needsReauth) {
        setDiagResult('NEEDS_REAUTH')
        return
      }
      if (data.error) {
        setDiagResult(`Error: ${data.error}`)
        return
      }
      // Format a readable summary
      const lines = [
        `📬 Emails encontrados en Gmail: ${data.total}`,
        `✅ Listos para procesar: ${data.willProcess}`,
        `🔁 Ya procesados: ${data.alreadyProcessed}`,
        `❌ Subject no coincide con patrón AMARILO: ${data.patternMismatch}`,
        '',
        ...data.emails.map((e: {
          subject: string; date: string; isUnread: boolean;
          patternMatch: boolean; alreadyProcessed: boolean; willProcess: boolean; logError?: string
        }) =>
          `${e.willProcess ? '▶' : e.alreadyProcessed ? '✓' : '✗'} [${e.date.slice(0,16)}] ${e.subject}` +
          (e.logError ? ` ⚠ ${e.logError}` : '') +
          (!e.patternMatch ? ' (subject no coincide)' : '') +
          (e.alreadyProcessed ? ' (ya procesado)' : '')
        ),
      ]
      setDiagResult(lines.join('\n'))
    } catch (err) {
      setDiagResult(`Error: ${err}`)
    } finally {
      setDiagnosing(false)
    }
  }

  async function handleTestEmail() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/cron/trigger', { method: 'POST' })
      const data = await res.json()
      if (data.error?.includes('invalid_grant') || data.needsReauth) {
        setTestResult('NEEDS_REAUTH')
      } else {
        setTestResult(JSON.stringify(data, null, 2))
      }
    } catch (err) {
      setTestResult(`Error: ${err}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Gmail */}
      {/* OAuth status banner */}
      {oauthStatus === 'success' && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
          <span className="text-xl">✅</span>
          <p className="text-sm text-green-800 font-medium">{oauthMessage}</p>
        </div>
      )}
      {oauthStatus === 'error' && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <span className="text-xl">❌</span>
          <div>
            <p className="text-sm text-red-800 font-medium">Error al autorizar Gmail</p>
            <p className="text-xs text-red-600 mt-0.5">{oauthMessage}</p>
          </div>
        </div>
      )}

      <Section
        title="Gmail API"
        desc="Para monitorear emails con briefs de proyectos"
        icon="📧"
        guide={<OAuthGuide clientId={settings.gmail?.clientId} clientSecret={settings.gmail?.clientSecret} />}
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
            value={settings.gmail?.refreshToken === '***saved***' ? '' : (settings.gmail?.refreshToken || '')}
            onChange={(v) => update('gmail', 'refreshToken', v)}
            type="password"
            placeholder={settings.gmail?.refreshToken === '***saved***' ? '✓ Token guardado' : 'Pega aquí el refresh token'}
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

        {settings.gmail?.clientId && settings.gmail?.clientSecret && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-800">Autorización OAuth directa</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Genera un refresh token permanente sin pasar por OAuth Playground.
                El token se guarda automáticamente en la base de datos.
              </p>
            </div>
            <a
              href="/api/auth/gmail"
              className="flex-shrink-0 ml-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              Conectar Gmail →
            </a>
          </div>
        )}
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
        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleTestEmail}
            disabled={testing}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-60"
          >
            {testing ? 'Ejecutando...' : '▶ Ejecutar manualmente'}
          </button>
          <button
            type="button"
            onClick={handleDiagnose}
            disabled={diagnosing}
            className="px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-100 disabled:opacity-60"
          >
            {diagnosing ? 'Diagnosticando...' : '🔍 Diagnóstico de emails'}
          </button>
        </div>
        {diagResult && diagResult !== 'NEEDS_REAUTH' && (
          <pre className="mt-3 p-3 bg-gray-900 text-cyan-300 text-xs rounded-lg overflow-x-auto whitespace-pre-wrap">{diagResult}</pre>
        )}
        {diagResult === 'NEEDS_REAUTH' && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            Token expirado. <a href="/api/auth/gmail" className="underline font-medium">Re-conectar Gmail →</a>
          </div>
        )}

        {testResult === 'NEEDS_REAUTH' ? (
          <div className="mt-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0">🔑</span>
              <div>
                <p className="text-sm font-semibold text-red-800">Token de Gmail expirado</p>
                <p className="text-xs text-red-600 mt-1">
                  El refresh token ya no es válido (<code>invalid_grant</code>). Debes re-autorizar la conexión con Gmail.
                </p>
                <a
                  href="/api/auth/gmail"
                  className="inline-block mt-3 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
                >
                  Re-conectar Gmail →
                </a>
              </div>
            </div>
          </div>
        ) : testResult ? (
          <pre className="mt-2 p-3 bg-gray-900 text-green-400 text-xs rounded-lg overflow-x-auto">{testResult}</pre>
        ) : null}
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

function OAuthGuide({ clientId, clientSecret }: { clientId?: string; clientSecret?: string }) {
  // Build a pre-filled OAuth Playground URL
  const playgroundUrl = 'https://developers.google.com/oauthplayground'

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mt-2 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">🔑</span>
        <p className="text-sm font-semibold text-blue-800">Cómo obtener el Refresh Token (5 pasos)</p>
      </div>

      <ol className="text-xs text-blue-700 space-y-2 list-none">
        <li className="flex gap-2">
          <span className="font-bold w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs">1</span>
          <span>
            Abre{' '}
            <a
              href={playgroundUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline text-blue-800 hover:text-blue-600"
            >
              Google OAuth Playground →
            </a>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-bold w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs">2</span>
          <span>
            Click en el ⚙️ (arriba a la derecha) →{' '}
            <strong>Use your own OAuth credentials</strong> → pega tu{' '}
            <strong>Client ID</strong> y <strong>Client Secret</strong>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-bold w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs">3</span>
          <span>
            Panel izquierdo → busca <strong>Gmail API v1</strong> → selecciona{' '}
            <code className="bg-blue-100 px-1 rounded">https://mail.google.com/</code> →{' '}
            <strong>Authorize APIs</strong>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-bold w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs">4</span>
          <span>
            Inicia sesión con la cuenta que recibe los briefs → acepta permisos →{' '}
            <strong>Exchange authorization code for tokens</strong>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-bold w-5 h-5 bg-blue-200 text-blue-800 rounded-full flex items-center justify-center flex-shrink-0 text-xs">5</span>
          <span>
            Copia el <strong>Refresh token</strong> que aparece → pégalo en el campo de abajo
          </span>
        </li>
      </ol>

      {(!clientId || !clientSecret) && (
        <p className="text-xs text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
          ⚠️ Primero guarda el Client ID y Client Secret para poder usarlos en el Playground
        </p>
      )}
    </div>
  )
}
