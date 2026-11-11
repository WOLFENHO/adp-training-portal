import type { Metadata } from 'next'
import './globals.css'
export const metadata: Metadata = { title: 'ADP | Internal Training Portal', description: 'Analytics Development Program internal training portal' }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html> }
