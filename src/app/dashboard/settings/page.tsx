export const dynamic = 'force-dynamic'
import SettingsForm from '@/components/settings/SettingsForm'
import { prisma } from '@/lib/prisma'

async function getSettings() {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  if (!settings) return {}
  const data = JSON.parse(settings.data)
  // Mask sensitive values for display
  if (data.gmail?.refreshToken) data.gmail.refreshToken = '***saved***'
  if (data.googleDrive?.privateKey) data.googleDrive.privateKey = '***saved***'
  return data
}

export default async function SettingsPage() {
  const settings = await getSettings()

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-sm text-gray-500 mt-1">
          Credenciales para Gmail, Google Drive y configuración del equipo
        </p>
      </div>
      <SettingsForm initialSettings={settings} />
    </div>
  )
}
