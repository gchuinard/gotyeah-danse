// Matérialisation du plan de salle (Section / Row / Seat) depuis une
// VenueConfig — partagée entre `pnpm db:seed` et l'activation d'une salle
// depuis l'admin (/admin/salles) : changer de plan ne demande PLUS de reseed.
//
// Reproductible et relançable : upserts partout (ids déterministes de
// lib/venue/generate.ts), puis suppression des orphelins.
//
// Garde-fous :
//  - si un siège qui disparaîtrait porte des BILLETS, on refuse tout net
//    (annuler/déplacer les demandes concernées d'abord) — les overrides
//    (blocages), eux, sont nettoyés silencieusement ;
//  - `Seat.removable` n'est PAS réécrit sur les sièges existants : les
//    bascules fixe ↔ amovible faites dans l'admin survivent aux synchros.
//    Les scores, calculés, sont eux ré-écrits (calibration AVANT les ventes).

import type { PrismaClient } from '@prisma/client'

import type { VenueConfig } from '@/config/venue'

import { generateSeats, SECTION_ORDER } from './generate'

const CHUNK = 200 // SQLite : limite de paramètres par requête (~999)

function* chunks<T>(items: T[]): Generator<T[]> {
  for (let i = 0; i < items.length; i += CHUNK) yield items.slice(i, i + CHUNK)
}

export type SyncResult = { sections: number; rows: number; seats: number; deleted: number }

export async function syncPlan(db: PrismaClient, config: VenueConfig): Promise<SyncResult> {
  const seats = generateSeats(config)
  const seatIds = new Set(seats.map((s) => s.id))

  // Garde billets : les sièges qui disparaîtraient ne doivent porter aucun
  // ticket (toutes représentations confondues — un billet émis fait foi).
  const existants = await db.seat.findMany({ select: { id: true } })
  const orphelins = existants.map((s) => s.id).filter((id) => !seatIds.has(id))
  if (orphelins.length > 0) {
    let billetes = 0
    for (const lot of chunks(orphelins)) {
      billetes += await db.ticket.count({ where: { seatId: { in: lot } } })
    }
    if (billetes > 0) {
      throw new Error(
        `${billetes} billet(s) émis sur des sièges qui n'existent pas dans ce plan. ` +
          `Annulez ou déplacez les demandes concernées avant de changer de salle.`,
      )
    }
  }

  // Sections — id = nom, ordre fixe gauche/centre/droite.
  const sections = (Object.entries(SECTION_ORDER) as [string, number][]).map(([id, order]) => ({
    id,
    name: id,
    order,
  }))
  await db.$transaction(
    sections.map((s) =>
      db.section.upsert({ where: { id: s.id }, update: { name: s.name, order: s.order }, create: s }),
    ),
  )

  // Rangées — une par couple (section, label), dédupliquées depuis les sièges.
  const rows = new Map<string, { id: string; sectionId: string; label: string; order: number }>()
  for (const s of seats) {
    rows.set(s.rowId, { id: s.rowId, sectionId: s.section, label: s.rowLabel, order: s.rowOrder })
  }
  await db.$transaction(
    [...rows.values()].map((r) =>
      db.row.upsert({
        where: { id: r.id },
        update: { sectionId: r.sectionId, label: r.label, order: r.order },
        create: r,
      }),
    ),
  )

  // Sièges — upserts par paquets. `removable` uniquement à la création
  // (les retouches admin priment sur la config pour les sièges existants).
  for (const lot of chunks(seats)) {
    await db.$transaction(
      lot.map((s) => {
        const commun = {
          rowId: s.rowId,
          number: s.number,
          indexInRow: s.indexInRow,
          x: s.x,
          y: s.y,
          angle: s.angle,
          score: s.score,
        }
        return db.seat.upsert({
          where: { id: s.id },
          update: commun,
          create: { id: s.id, ...commun, removable: s.removable },
        })
      }),
    )
  }

  // Orphelins : overrides (blocages) d'abord, puis sièges, puis rangées.
  let deleted = 0
  for (const lot of chunks(orphelins)) {
    await db.seatOverride.deleteMany({ where: { seatId: { in: lot } } })
    deleted += (await db.seat.deleteMany({ where: { id: { in: lot } } })).count
  }
  const rowIds = [...rows.keys()]
  const lignesExistantes = await db.row.findMany({ select: { id: true } })
  const lignesOrphelines = lignesExistantes.map((r) => r.id).filter((id) => !rowIds.includes(id))
  for (const lot of chunks(lignesOrphelines)) {
    await db.row.deleteMany({ where: { id: { in: lot } } })
  }

  return { sections: sections.length, rows: rows.size, seats: seats.length, deleted }
}
