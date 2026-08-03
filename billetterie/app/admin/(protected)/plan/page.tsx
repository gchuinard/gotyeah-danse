// /admin/plan — vue plan de salle dédiée, multi-bénévoles.
//
// Server component : choisit la représentation (?rep=, défaut = première des
// ACTIVES — les archivées ne sont plus proposées), charge l'état du plan, et
// délègue l'interactif (polling 5 s, mode blocages) au client component PlanView.

import type { Metadata } from 'next'

import { getSeatMap } from '@/lib/admin/seat-map'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

import PlanView from './plan-view'

export const metadata: Metadata = {
  title: 'Plan de salle',
}

const formatDateHeure = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
})

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string | string[] }>
}) {
  await requireAdmin()

  const { rep } = await searchParams
  const repParam = Array.isArray(rep) ? rep[0] : rep

  // Une seule requête : on filtre les archivées côté JS (2 représentations par
  // an) pour pouvoir distinguer « base vide » de « tout est archivé ».
  const toutes = await prisma.representation.findMany({
    orderBy: { startsAt: 'asc' },
    select: { id: true, title: true, startsAt: true, archivedAt: true },
  })
  const representations = toutes.filter((r) => r.archivedAt === null)
  if (representations.length === 0) {
    return toutes.length === 0 ? (
      <p>Aucune représentation en base — lancez le seed.</p>
    ) : (
      <p>
        Toutes les représentations sont archivées — désarchivez-en une dans
        « Représentations » pour retrouver son plan.
      </p>
    )
  }

  const selected = representations.find((r) => r.id === repParam) ?? representations[0]
  const seats = await getSeatMap(prisma, selected.id)

  return (
    <PlanView
      key={selected.id}
      representations={representations.map((r) => ({
        id: r.id,
        label: `${r.title} — ${formatDateHeure.format(r.startsAt)}`,
      }))}
      repId={selected.id}
      initialSeats={seats}
    />
  )
}
