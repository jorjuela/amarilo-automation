import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import ImageEditorClient from '@/components/image-editor/ImageEditorClient'

export default async function ImageEditorPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-3 bg-white border-b border-gray-200 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg" style={{ background: '#1B3D6B' }}>
          🖼
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">Editor de Imágenes</h1>
          <p className="text-xs text-gray-400">Imagen → HTML editable (IA) → PNG de alta calidad (Playwright)</p>
        </div>
      </div>

      {/* Editor fills remaining height */}
      <div className="flex-1 min-h-0 relative">
        <ImageEditorClient />
      </div>
    </div>
  )
}
