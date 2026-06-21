// /admin/salles/nouvelle — créateur de salle : relevé en notation place.md +
// paramètres de géométrie → aperçu live → fichier JSON multi-salles
// (config/venues/<id>.json, activé par VENUE_ID). Tout se passe côté client
// (parser et générateur purs) ; rien n'est écrit en base ici.

import type { Metadata } from 'next'

import { requireSuperAdmin } from '@/lib/auth/require-admin'

import BuilderView from './builder-view'

export const metadata: Metadata = { title: 'Créer une salle — Billetterie admin' }

export default async function NouvelleSallePage() {
  await requireSuperAdmin()
  return <BuilderView />
}
