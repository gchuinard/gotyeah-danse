// Jauge d'une représentation — TOUJOURS calculée, jamais stockée.
//
// jauge = sièges actifs (total − overrides) − billets émis
//         − Σ partySize des demandes pending/paid non expirées.
//
// Une demande `pending` consomme de la jauge (un compteur), jamais des sièges
// précis. Les demandes `placed` sont comptées via leurs tickets.

import type { Prisma, PrismaClient } from '@prisma/client'

// Accepte le client global OU un client transactionnel : la vérification de
// jauge avant création d'un booking DOIT se faire dans la même transaction.
export type Db = PrismaClient | Prisma.TransactionClient

export async function computeJauge(db: Db, representationId: string, now = new Date()): Promise<number> {
  const [seats, overrides, tickets, holds] = await Promise.all([
    db.seat.count(),
    db.seatOverride.count({ where: { representationId } }),
    db.ticket.count({ where: { representationId } }),
    db.booking.aggregate({
      _sum: { partySize: true },
      where: {
        representationId,
        status: { in: ['pending', 'paid'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
  ])
  return seats - overrides - tickets - (holds._sum.partySize ?? 0)
}

// Représentations proposables sur le formulaire public : ouvertes, avec leur
// jauge (le formulaire n'affiche que celles dont la jauge est > 0).
export async function representationsOuvertes(db: Db, now = new Date()) {
  const reps = await db.representation.findMany({
    where: { isOpen: true },
    orderBy: { startsAt: 'asc' },
  })
  return Promise.all(
    reps.map(async (rep) => ({ ...rep, jauge: await computeJauge(db, rep.id, now) })),
  )
}
