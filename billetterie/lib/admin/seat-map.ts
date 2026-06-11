// État du plan de salle pour UNE représentation, côté serveur.
//
// Le statut d'un siège n'existe pas en base (voir schema.prisma) : il se
// déduit ici de l'existence d'un Ticket (occupé) ou d'un SeatOverride
// (bloqué). Trois requêtes, assemblage en mémoire — 818 sièges, trivial.

import type { PrismaClient } from '@prisma/client'

import type { SeatState } from '@/lib/placement'

export type SeatView = {
  id: string
  x: number
  y: number
  section: string // id de section : 'gauche' | 'centre' | 'droite'
  rowLabel: string
  number: number
  indexInRow: number
  rowOrder: number
  score: number
  removable: boolean
  status: 'libre' | 'occupe' | 'bloque'
  occupant?: string // nom de la famille si occupé
  overrideReason?: string // si bloqué
}

export async function getSeatMap(
  db: PrismaClient,
  representationId: string,
): Promise<SeatView[]> {
  const [seats, tickets, overrides] = await Promise.all([
    db.seat.findMany({
      include: { row: { include: { section: true } } },
    }),
    db.ticket.findMany({
      where: { representationId },
      select: { seatId: true, booking: { select: { name: true } } },
    }),
    db.seatOverride.findMany({
      where: { representationId },
      select: { seatId: true, reason: true },
    }),
  ])

  const occupantBySeat = new Map(tickets.map((t) => [t.seatId, t.booking.name]))
  const reasonBySeat = new Map(overrides.map((o) => [o.seatId, o.reason]))

  return seats
    .map((seat): SeatView => {
      // Un Ticket prime toujours sur un override (l'action de blocage
      // interdit de bloquer un siège ticketé, mais on reste défensif).
      const occupant = occupantBySeat.get(seat.id)
      const overrideReason = occupant === undefined ? reasonBySeat.get(seat.id) : undefined
      return {
        id: seat.id,
        x: seat.x,
        y: seat.y,
        section: seat.row.section.id,
        rowLabel: seat.row.label,
        number: seat.number,
        indexInRow: seat.indexInRow,
        rowOrder: seat.row.order,
        score: seat.score,
        removable: seat.removable,
        status: occupant !== undefined ? 'occupe' : overrideReason !== undefined ? 'bloque' : 'libre',
        ...(occupant !== undefined ? { occupant } : {}),
        ...(overrideReason !== undefined ? { overrideReason } : {}),
      }
    })
    .sort(
      (a, b) =>
        a.rowOrder - b.rowOrder || a.section.localeCompare(b.section) || a.indexInRow - b.indexInRow,
    )
}

// Conversion vers le contrat du moteur de placement : les sièges bloqués
// sont ABSENTS du tableau (cf. lib/placement/types.ts), un siège occupé
// devient free: false. rowId = "<section>-<label>" (ids déterministes du seed).
export function toSeatStates(seats: SeatView[]): SeatState[] {
  return seats
    .filter((seat) => seat.status !== 'bloque')
    .map((seat) => ({
      id: seat.id,
      section: seat.section,
      rowId: `${seat.section}-${seat.rowLabel}`,
      rowLabel: seat.rowLabel,
      rowOrder: seat.rowOrder,
      indexInRow: seat.indexInRow,
      number: seat.number,
      score: seat.score,
      free: seat.status === 'libre',
    }))
}
