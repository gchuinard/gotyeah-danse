import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: 'Billetterie — École de danse Desha-Moulin',
  description:
    "Demandez vos places pour le spectacle de fin d'année de l'école de danse Desha-Moulin.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
