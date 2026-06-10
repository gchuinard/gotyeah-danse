// /admin/scan — scan des billets à l'entrée, le soir du spectacle.
//
// Server component minimal : choisit la représentation (?rep=, défaut =
// la première à venir) et délègue tout le reste à ScanView, qui charge le
// manifeste des billets côté client et fonctionne ensuite SANS réseau
// (validation locale + file de synchro) — le wifi de la salle municipale
// étant une légende urbaine.

import type { Metadata } from 'next'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

import ScanView from './scan-view'

export const metadata: Metadata = {
  title: 'Scan des billets',
}

const formatDateHeure = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
})

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string | string[] }>
}) {
  await requireAdmin()

  const { rep } = await searchParams
  const repParam = Array.isArray(rep) ? rep[0] : rep

  const representations = await prisma.representation.findMany({
    orderBy: { startsAt: 'asc' },
    select: { id: true, title: true, startsAt: true },
  })
  if (representations.length === 0) {
    return <p>Aucune représentation en base — lancez le seed.</p>
  }

  // Défaut : la première représentation à venir (c'est celle qu'on scanne
  // ce soir) ; à défaut la dernière passée.
  const now = new Date()
  const selected =
    representations.find((r) => r.id === repParam) ??
    representations.find((r) => r.startsAt >= now) ??
    representations[representations.length - 1]

  return (
    <ScanView
      key={selected.id}
      representations={representations.map((r) => ({
        id: r.id,
        label: `${r.title} — ${formatDateHeure.format(r.startsAt)}`,
      }))}
      repId={selected.id}
    />
  )
}
