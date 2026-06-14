import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import FigmaHtmlClient from './FigmaHtmlClient'

export default async function FigmaHtmlPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  const settingsData = settings ? JSON.parse(settings.data) : {}

  const hasFigmaToken = !!(settingsData.figma?.token)
  const priceLayerName = settingsData.figmaLayers?.priceLayerName ?? 'precio'

  return <FigmaHtmlClient hasFigmaToken={hasFigmaToken} defaultPriceLayerName={priceLayerName} />
}
