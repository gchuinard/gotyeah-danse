// /admin/salles/[id]/modifier — rouvre une salle enregistrée dans l'éditeur.
// La config JSON est re-sérialisée en notation (lib/venue/place-notation) :
// l'éditeur travaille toujours sur le relevé, quelle que soit l'origine de la
// salle. La géométrie d'affichage repart des réglages par défaut (indicative).

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireSuperAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { serialiseVenueConfig } from '@/lib/venue/place-notation'
import { parseVenueConfig } from '@/lib/venue/schema'

import BuilderView from '../../nouvelle/builder-view'

export const metadata: Metadata = { title: 'Modifier la salle — Billetterie admin' }

export default async function ModifierSallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin()
  const { id } = await params

  const venue = await prisma.venue.findUnique({ where: { id } })
  if (!venue) notFound()

  // Le relevé stocké est la source exacte (couloirs/décalages compris) ;
  // à défaut, on re-sérialise la config (géométrie indicative).
  const notation =
    venue.notation ??
    serialiseVenueConfig(parseVenueConfig(JSON.parse(venue.config), `salle « ${venue.name} »`))

  return <BuilderView initial={{ id: venue.id, name: venue.name, notation }} />
}
