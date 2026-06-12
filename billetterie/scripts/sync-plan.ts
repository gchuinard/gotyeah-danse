// Met à jour UNIQUEMENT la géométrie du plan (Section/Row/Seat) — SANS toucher
// aux représentations ni aux bookings/billets.
//
//   pnpm sync:plan
//
// - Si une salle est ACTIVE et possède un relevé (notation) : on RÉGÉNÈRE sa
//   config avec le constructeur courant (géométrie linéaire, fond non dilaté),
//   on synchronise le plan, puis on persiste la config régénérée. Les comptes,
//   numéros et ids de sièges sont inchangés (seuls x/y/angle bougent).
// - Sinon : on synchronise la config active telle quelle (fichier / intégrée).
//
// syncPlan préserve `removable` sur les sièges existants et REFUSE (avant toute
// écriture) de supprimer un siège portant un billet — l'opération est donc sûre
// sur une base de prod : en cas d'incompatibilité, rien n'est modifié.

import { PrismaClient } from '@prisma/client'

import { BUILDER_DEFAULTS, buildVenueConfig } from '../lib/venue/build'
import { generateSeats } from '../lib/venue/generate'
import { loadActiveVenueConfig } from '../lib/venue/load'
import { parsePlaceNotation } from '../lib/venue/place-notation'
import { parseVenueConfig } from '../lib/venue/schema'
import { syncPlan } from '../lib/venue/sync'
import type { VenueConfig } from '../config/venue'

const prisma = new PrismaClient()

// Demi-largeur réelle max (px) parmi tous les sièges — indicateur de dilatation.
function demiLargeurMax(config: VenueConfig): number {
  const cx = config.center.x
  let max = 0
  for (const s of generateSeats(config)) max = Math.max(max, Math.abs(s.x - cx))
  return Math.round(max)
}

async function main() {
  const active = await prisma.venue.findFirst({ where: { isActive: true } })

  let config: VenueConfig
  let venueToPersist: { id: string } | null = null

  if (active?.notation) {
    const avant = JSON.parse(active.config) as VenueConfig
    const rows = parsePlaceNotation(active.notation)
    const regen = buildVenueConfig({ name: active.name, ...BUILDER_DEFAULTS }, rows)
    config = parseVenueConfig(regen, `salle « ${active.name} »`)
    venueToPersist = { id: active.id }
    console.log(`Salle active « ${active.name} » régénérée depuis son relevé (géométrie linéaire).`)
    console.log(`  demi-largeur max : ${demiLargeurMax(avant)} px → ${demiLargeurMax(config)} px`)
  } else {
    const loaded = await loadActiveVenueConfig(prisma)
    config = loaded.config
    console.log(`Salle : ${config.name ?? 'sans nom'} (source : ${loaded.source})`)
  }

  // 1) Synchronise le plan (échoue AVANT toute écriture si un billet bloque).
  const r = await syncPlan(prisma, config)
  // 2) Seulement si la synchro a réussi : persiste la config régénérée.
  if (venueToPersist) {
    await prisma.venue.update({
      where: { id: venueToPersist.id },
      data: { config: JSON.stringify(config) },
    })
  }

  console.log(
    `Plan synchronisé : ${r.seats} sièges, ${r.rows} rangées, ${r.sections} sections` +
      (r.deleted ? `, ${r.deleted} orphelin(s) supprimé(s)` : ''),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
