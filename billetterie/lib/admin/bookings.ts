// Logique métier back-office des demandes — PURE DB, donc testable :
// pas d'email, pas d'auth ici. Chaque fonction reçoit le client Prisma en
// paramètre (client global en prod, client jetable dans les tests).
//
// Concurrence entre bénévoles : les vérifications de disponibilité se font
// dans la transaction, et la contrainte @@unique([representationId, seatId])
// de Ticket absorbe les vraies courses (deux émissions simultanées sur le
// même siège) → P2002, traduit en erreur française affichable.

import { randomUUID } from 'node:crypto'

import { Prisma, type PrismaClient } from '@prisma/client'

import { PMR_REASON } from '@/lib/admin/seat-map'
import { computeJauge } from '@/lib/jauge'
import { MAX_PARTY_SIZE } from '@/lib/public/limits'

export type BookingAvecBillets = {
  id: string
  name: string
  email: string
  partySize: number
  publicToken: string
  paidAt: Date | null
  representation: { title: string; startsAt: Date }
  tickets: Array<{
    qrToken: string
    seat: { number: number; row: { label: string; section: { name: string } } }
  }>
}

const SIEGE_DEJA_PRIS = "Un de ces sièges vient d'être pris, recharge le plan"

const QUATORZE_JOURS_MS = 14 * 24 * 60 * 60 * 1000

// Sélection du shape BookingAvecBillets — billets triés par rangée puis numéro.
const selectionBookingAvecBillets = {
  id: true,
  name: true,
  email: true,
  partySize: true,
  publicToken: true,
  paidAt: true, // gate l'envoi auto des billets : non réglé → pas d'email auto
  representation: { select: { title: true, startsAt: true } },
  tickets: {
    orderBy: [{ seat: { rowId: 'asc' } }, { seat: { number: 'asc' } }],
    select: {
      qrToken: true,
      seat: {
        select: {
          number: true,
          row: { select: { label: true, section: { select: { name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

type Tx = Prisma.TransactionClient

export type Reglement = {
  paymentMethod?: 'especes' | 'cheque' | 'autre'
  amountCents?: number
}

// Enregistre le règlement d'une demande. Paiement et placement sont
// INDÉPENDANTS : on peut payer une demande en attente (→ paid, « à placer »)
// OU une demande déjà placée mais non réglée (paiement après coup → reste
// placed). Le règlement (méthode + montant) est facultatif — saisi pour la
// réconciliation de caisse, jamais bloquant. Renvoie `etaitPlace` pour que
// l'action sache où rediriger (liste si déjà placée, écran de placement sinon).
export async function marquerPayee(
  db: PrismaClient,
  bookingId: string,
  reglement: Reglement = {},
): Promise<{ etaitPlace: boolean }> {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new Error('Demande introuvable.')

    // Déjà réglée : statut payé, ou placée avec un paidAt déjà posé.
    if (booking.status === 'paid' || (booking.status === 'placed' && booking.paidAt)) {
      throw new Error('Cette demande est déjà réglée.')
    }
    // Payable : en attente (non expirée) ou déjà placée mais non réglée.
    if (booking.status !== 'pending' && booking.status !== 'placed') {
      throw new Error('Cette demande ne peut pas être marquée payée.')
    }
    if (booking.status === 'pending' && booking.expiresAt && booking.expiresAt <= new Date()) {
      throw new Error('Cette demande est expirée — prolonge-la avant de la marquer payée.')
    }

    const etaitPlace = booking.status === 'placed'
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        // Une demande en attente passe « à placer » ; une placée le reste.
        status: etaitPlace ? 'placed' : 'paid',
        paidAt: new Date(),
        paymentMethod: reglement.paymentMethod ?? null,
        amountCents: reglement.amountCents ?? null,
      },
    })
    return { etaitPlace }
  })
}

// Vérifications communes émission / déplacement : sièges existants, sans
// doublon, sans override ni ticket pour la représentation. Les tickets du
// booking lui-même doivent avoir été supprimés AVANT (cas du déplacement).
async function verifierSiegesDisponibles(
  tx: Tx,
  representationId: string,
  seatIds: string[],
): Promise<void> {
  if (new Set(seatIds).size !== seatIds.length) {
    throw new Error('Un même siège est sélectionné deux fois.')
  }
  const existants = await tx.seat.count({ where: { id: { in: seatIds } } })
  if (existants !== seatIds.length) {
    throw new Error("Un de ces sièges n'existe pas dans le plan.")
  }
  // Les blocages « réservé PMR » sont placeables à la main (ces sièges sont
  // justement gardés pour les familles PMR) ; les autres blocages (console,
  // fosse, amovibles non posés…) restent interdits.
  const blocages = await tx.seatOverride.findMany({
    where: { representationId, seatId: { in: seatIds } },
    select: { reason: true },
  })
  if (blocages.some((b) => b.reason !== PMR_REASON)) {
    throw new Error('Un de ces sièges est bloqué pour cette représentation.')
  }
  // Même message que le catch P2002 : pour le bénévole, le siège est pris,
  // peu importe que la course soit détectée avant ou pendant l'insertion.
  const occupes = await tx.ticket.count({
    where: { representationId, seatId: { in: seatIds } },
  })
  if (occupes > 0) throw new Error(SIEGE_DEJA_PRIS)
}

function traduireP2002(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new Error(SIEGE_DEJA_PRIS)
  }
  throw error
}

// Exporté aussi pour le « renvoyer les billets » de la liste des demandes.
export async function chargerBookingAvecBillets(
  db: PrismaClient | Tx,
  bookingId: string,
): Promise<BookingAvecBillets> {
  return db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: selectionBookingAvecBillets,
  })
}

// paid → placed : LA transaction d'émission des billets.
export async function emettreBillets(
  db: PrismaClient,
  bookingId: string,
  seatIds: string[],
): Promise<BookingAvecBillets> {
  return db
    .$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId } })
      if (!booking) throw new Error('Demande introuvable.')
      // On place une demande payée OU en attente (paiement plus tard) : le
      // placement et le paiement sont indépendants. Une pending placée reste
      // non réglée (paidAt inchangé) jusqu'à un « marquer payée » ultérieur.
      if (booking.status !== 'paid' && booking.status !== 'pending') {
        throw new Error('Seule une demande en attente ou payée peut être placée.')
      }
      if (booking.status === 'pending' && booking.expiresAt && booking.expiresAt <= new Date()) {
        throw new Error('Cette demande est expirée — prolonge-la avant de la placer.')
      }
      if (seatIds.length !== booking.partySize) {
        throw new Error(
          `Il faut sélectionner exactement ${booking.partySize} siège(s) (${seatIds.length} sélectionné(s)).`,
        )
      }
      await verifierSiegesDisponibles(tx, booking.representationId, seatIds)
      // Une réservation PMR remplie est consommée : on lève l'override.
      await tx.seatOverride.deleteMany({
        where: { representationId: booking.representationId, seatId: { in: seatIds }, reason: PMR_REASON },
      })

      await tx.ticket.createMany({
        data: seatIds.map((seatId) => ({
          bookingId: booking.id,
          representationId: booking.representationId,
          seatId,
          qrToken: randomUUID(),
        })),
      })
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'placed', placedAt: new Date() },
      })
      return chargerBookingAvecBillets(tx, booking.id)
    })
    .catch(traduireP2002)
}

// placed → placed sur de NOUVEAUX sièges : suppression de TOUS les anciens
// tickets puis recréation avec de NOUVEAUX qrToken (les anciens QR deviennent
// invalides). Les sièges actuels du booking comptent comme libres pour
// lui-même : ses tickets sont supprimés AVANT la vérification.
export async function deplacerBillets(
  db: PrismaClient,
  bookingId: string,
  seatIds: string[],
): Promise<BookingAvecBillets> {
  return db
    .$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId } })
      if (!booking) throw new Error('Demande introuvable.')
      if (booking.status !== 'placed') {
        throw new Error("Cette demande n'est pas encore placée.")
      }
      if (seatIds.length !== booking.partySize) {
        throw new Error(
          `Il faut sélectionner exactement ${booking.partySize} siège(s) (${seatIds.length} sélectionné(s)).`,
        )
      }

      await tx.ticket.deleteMany({ where: { bookingId: booking.id } })
      await verifierSiegesDisponibles(tx, booking.representationId, seatIds)
      await tx.seatOverride.deleteMany({
        where: { representationId: booking.representationId, seatId: { in: seatIds }, reason: PMR_REASON },
      })

      await tx.ticket.createMany({
        data: seatIds.map((seatId) => ({
          bookingId: booking.id,
          representationId: booking.representationId,
          seatId,
          qrToken: randomUUID(),
        })),
      })
      await tx.booking.update({
        where: { id: booking.id },
        data: { placedAt: new Date() },
      })
      return chargerBookingAvecBillets(tx, booking.id)
    })
    .catch(traduireP2002)
}

// pending/paid/placed → cancelled : suppression des tickets éventuels +
// statut. Libère sièges ET jauge par construction — tout est calculé.
export async function annulerDemande(
  db: PrismaClient,
  bookingId: string,
): Promise<{ name: string; email: string; partySize: number; representation: { title: string; startsAt: Date } }> {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        status: true,
        name: true,
        email: true,
        partySize: true,
        representation: { select: { title: true, startsAt: true } },
      },
    })
    if (!booking) throw new Error('Demande introuvable.')
    if (!['pending', 'paid', 'placed'].includes(booking.status)) {
      throw new Error('Cette demande est déjà annulée.')
    }

    await tx.ticket.deleteMany({ where: { bookingId } })
    await tx.booking.update({ where: { id: bookingId }, data: { status: 'cancelled' } })

    return {
      name: booking.name,
      email: booking.email,
      partySize: booking.partySize,
      representation: booking.representation,
    }
  })
}

// Changer le nombre de places d'une demande.
//  - pending/paid : met à jour partySize (vérif jauge si augmentation) ;
//  - placed : le placement devient caduc → suppression des billets et retour
//    en 'paid' pour que l'admin re-place avec le nouveau nombre ;
//  - cancelled/expired : refusé.
// `etaitPlace` indique à l'action qu'un re-placement est nécessaire.
export async function changerNombrePlaces(
  db: PrismaClient,
  bookingId: string,
  nouveauNombre: number,
): Promise<{ etaitPlace: boolean }> {
  if (!Number.isInteger(nouveauNombre) || nouveauNombre < 1 || nouveauNombre > MAX_PARTY_SIZE) {
    throw new Error(`Le nombre de places doit être compris entre 1 et ${MAX_PARTY_SIZE}.`)
  }
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new Error('Demande introuvable.')
    if (!['pending', 'paid', 'placed'].includes(booking.status)) {
      throw new Error('Cette demande est annulée ou expirée.')
    }
    if (nouveauNombre === booking.partySize) {
      return { etaitPlace: false }
    }

    // Capacité max pour CETTE demande = jauge restante + sa propre empreinte
    // actuelle (partySize, en hold pending/paid ou en billets placed).
    const jauge = await computeJauge(tx, booking.representationId)
    const maxPourCetteDemande = jauge + booking.partySize
    if (nouveauNombre > maxPourCetteDemande) {
      throw new Error(
        `Jauge insuffisante : ${maxPourCetteDemande} place(s) au maximum pour cette demande.`,
      )
    }

    if (booking.status === 'placed') {
      await tx.ticket.deleteMany({ where: { bookingId } })
      await tx.booking.update({
        where: { id: bookingId },
        data: { partySize: nouveauNombre, status: 'paid', placedAt: null },
      })
      return { etaitPlace: true }
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: { partySize: nouveauNombre },
    })
    return { etaitPlace: false }
  })
}

// pending → expiresAt = maintenant + 14 jours.
export async function prolongerExpiration(db: PrismaClient, bookingId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new Error('Demande introuvable.')
    if (booking.status !== 'pending') {
      throw new Error('Seule une demande en attente peut être prolongée.')
    }
    await tx.booking.update({
      where: { id: bookingId },
      data: { expiresAt: new Date(Date.now() + QUATORZE_JOURS_MS) },
    })
  })
}
