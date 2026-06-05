import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import EditorImagenClient from './EditorImagenClient'

export default async function EditorImagenPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  return <EditorImagenClient />
}
