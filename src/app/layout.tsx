import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Amarilo Automation',
  description: 'Plataforma de automatización para proyectos Amarilo',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  )
}
