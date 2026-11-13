import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Realtime chat · Next.js 16 + Redis',
  description: 'Demo: Server Functions for writes, SSE Route Handler + Redis pub/sub for live updates.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
