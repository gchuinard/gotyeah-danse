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

import { montantDuCents } from '@/lib/admin/money'
import type { TicketPrices } from '@/lib/admin/pricing'
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
  ticketMode: string
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
  ticketMode: true, // "email" → envoi auto ; "papier" → jamais d'email (impression)
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

export type VersementInput = {
  method: 'especes' | 'cheque' | 'autre'
  amountCents: number // > 0
  depositOn?: Date | null // date de dépôt prévue (chèques échelonnés)
  reference?: string | null // n° de chèque / banque
  note?: string | null
}

// Enregistre UN versement (espèces ou chèque) sur une demande. Paiement et
// placement sont INDÉPENDANTS : on encaisse une demande en attente (→ paid,
// « à placer »), une demande « à placer » qui reçoit un nouveau chèque, OU une
// demande déjà placée non réglée. Plusieurs versements peuvent s'accumuler
// (paiement échelonné). Le 1er versement pose `paidAt` et fait passer une
// pending « à placer ». `nowSoldee` indique si, ce versement compris, le net
// atteint le montant dû — l'action s'en sert pour enchaîner sur le placement
// (cas courant : règlement complet en une fois). Prix non défini → on considère
// la demande comme « réglée » (préserve l'ancien flux « marquer payée »).
export async function ajouterPaiement(
  db: PrismaClient,
  bookingId: string,
  versement: VersementInput,
  prices: TicketPrices,
): Promise<{ etaitPending: boolean; etaitPlace: boolean; nowSoldee: boolean }> {
  if (!Number.isInteger(versement.amountCents) || versement.amountCents <= 0) {
    throw new Error('Le montant du versement doit être supérieur à 0.')
  }
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { payments: { select: { amountCents: true } } },
    })
    if (!booking) throw new Error('Demande introuvable.')
    if (booking.status !== 'pending' && booking.status !== 'paid' && booking.status !== 'placed') {
      throw new Error('Cette demande ne peut pas recevoir de versement.')
    }
    if (booking.status === 'pending' && booking.expiresAt && booking.expiresAt <= new Date()) {
      throw new Error('Cette demande est expirée — prolonge-la avant d’enregistrer un versement.')
    }

    const etaitPending = booking.status === 'pending'
    const etaitPlace = booking.status === 'placed'

    await tx.payment.create({
      data: {
        bookingId,
        method: versement.method,
        amountCents: versement.amountCents,
        depositOn: versement.depositOn ?? null,
        reference: versement.reference?.trim() || null,
        note: versement.note?.trim() || null,
      },
    })

    // 1er versement : pose paidAt ; une demande en attente passe « à placer ».
    const data: Prisma.BookingUpdateInput = {}
    if (!booking.paidAt) data.paidAt = new Date()
    if (etaitPending) data.status = 'paid'
    if (Object.keys(data).length > 0) {
      await tx.booking.update({ where: { id: bookingId }, data })
    }

    const remis =
      booking.payments.reduce((s, p) => s + p.amountCents, 0) + versement.amountCents
    const net = remis - (booking.refundCents ?? 0)
    const du = montantDuCents({
      partySize: booking.partySize,
      childCount: booking.childCount,
      freeSeats: booking.freeSeats,
      adultPriceCents: prices.adultCents,
      childPriceCents: prices.childCents,
    })
    const nowSoldee = du == null ? true : net >= du
    return { etaitPending, etaitPlace, nowSoldee }
  })
}

// Supprime UN versement (saisi par erreur). Si c'était le dernier, on efface le
// règlement : une demande « à placer » (paid) repasse en attente (échéance
// ré-armée), une placée GARDE ses sièges. Garde-fou : un remboursement devenu
// supérieur au reçu restant est retiré.
export async function supprimerPaiement(
  db: PrismaClient,
  bookingId: string,
  paymentId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.bookingId !== bookingId) throw new Error('Versement introuvable.')
    await tx.payment.delete({ where: { id: paymentId } })

    const agg = await tx.payment.aggregate({ where: { bookingId }, _sum: { amountCents: true } })
    const remis = agg._sum.amountCents ?? 0
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } })

    const data: Prisma.BookingUpdateInput = {}
    if (remis === 0) {
      // Plus aucun versement : règlement effacé (remboursement compris).
      data.paidAt = null
      data.refundCents = null
      data.refundReason = null
      if (booking.status === 'paid') {
        data.status = 'pending'
        data.expiresAt = new Date(Date.now() + QUATORZE_JOURS_MS)
      }
    } else if (booking.refundCents != null && booking.refundCents > remis) {
      // Le remboursement enregistré dépasse désormais le reçu : il n'a plus de
      // sens, on le retire (cohérence net = reçu − remboursé).
      data.refundCents = null
      data.refundReason = null
    }
    if (Object.keys(data).length > 0) {
      await tx.booking.update({ where: { id: bookingId }, data })
    }
  })
}

// Annule TOUT le règlement d'une demande (supprime tous les versements). Une
// demande « à placer » (paid) repasse EN ATTENTE (échéance ré-armée) ; une
// demande déjà placée GARDE ses sièges et redevient « placé non réglé ».
export async function annulerPaiement(
  db: PrismaClient,
  bookingId: string,
): Promise<{ statut: string }> {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new Error('Demande introuvable.')
    if (!booking.paidAt) throw new Error("Cette demande n'est pas marquée payée.")
    await tx.payment.deleteMany({ where: { bookingId } })
    // Effacer le règlement remet AUSSI à zéro un éventuel remboursement.
    const reglementVide = { paidAt: null, refundCents: null, refundReason: null }
    if (booking.status === 'paid') {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          ...reglementVide,
          status: 'pending',
          expiresAt: new Date(Date.now() + QUATORZE_JOURS_MS),
        },
      })
      return { statut: 'pending' }
    }
    if (booking.status === 'placed') {
      await tx.booking.update({ where: { id: bookingId }, data: reglementVide })
      return { statut: 'placed' }
    }
    throw new Error('Le règlement de cette demande ne peut pas être annulé.')
  })
}

// Définit le nombre de places OFFERTES d'une demande (ex. tout-petits qui
// dansent) : elles sont exclues du montant dû. Borné à [0, partySize].
export async function definirPlacesOffertes(
  db: PrismaClient,
  bookingId: string,
  freeSeats: number,
): Promise<void> {
  if (!Number.isInteger(freeSeats) || freeSeats < 0) {
    throw new Error('Le nombre de places offertes est invalide.')
  }
  await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new Error('Demande introuvable.')
    if (!['pending', 'paid', 'placed'].includes(booking.status)) {
      throw new Error('Cette demande est annulée ou expirée.')
    }
    if (booking.status === 'pending' && booking.expiresAt && booking.expiresAt <= new Date()) {
      throw new Error('Cette demande est expirée — prolonge-la avant de modifier les places offertes.')
    }
    if (freeSeats > booking.partySize) {
      throw new Error(`Au plus ${booking.partySize} place(s) offerte(s) sur cette demande.`)
    }
    await tx.booking.update({ where: { id: bookingId }, data: { freeSeats } })
  })
}

// Définit le nombre d'ENFANTS d'une demande (parmi partySize) → répartition du
// montant dû entre tarifs adulte / enfant. Borné à [0, partySize]. Retourne la
// répartition résultante pour l'historique.
export async function definirNombreEnfants(
  db: PrismaClient,
  bookingId: string,
  childCount: number,
): Promise<{ childCount: number; adultes: number }> {
  if (!Number.isInteger(childCount) || childCount < 0) {
    throw new Error("Le nombre d'enfants est invalide.")
  }
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new Error('Demande introuvable.')
    if (!['pending', 'paid', 'placed'].includes(booking.status)) {
      throw new Error('Cette demande est annulée ou expirée.')
    }
    if (childCount > booking.partySize) {
      throw new Error(`Au plus ${booking.partySize} enfant(s) sur cette demande.`)
    }
    await tx.booking.update({ where: { id: bookingId }, data: { childCount } })
    return { childCount, adultes: booking.partySize - childCount }
  })
}

// Enregistre (ou met à jour) le remboursement d'une demande déjà réglée — ex.
// après le retrait de places. `refundCents` est le TOTAL remboursé (cumulatif,
// éditable) ; la caisse compte le net = Σ versements − refundCents.
export async function enregistrerRemboursement(
  db: PrismaClient,
  bookingId: string,
  remboursement: { refundCents: number; refundReason?: string },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new Error('Demande introuvable.')
    const agg = await tx.payment.aggregate({ where: { bookingId }, _sum: { amountCents: true } })
    const remis = agg._sum.amountCents ?? 0
    if (remis <= 0) {
      throw new Error('Enregistrez d’abord un versement avant un remboursement.')
    }
    const { refundCents } = remboursement
    if (!Number.isInteger(refundCents) || refundCents <= 0) {
      throw new Error('Le montant remboursé doit être supérieur à 0.')
    }
    if (refundCents > remis) {
      throw new Error('Le remboursement ne peut pas dépasser le total reçu.')
    }
    await tx.booking.update({
      where: { id: bookingId },
      data: { refundCents, refundReason: remboursement.refundReason?.trim() || null },
    })
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

    // Annuler = tout libérer : billets ET versements (sinon l'argent d'une
    // demande annulée resterait compté en caisse, et les sièges revendus
    // feraient un double comptage). Le remboursement physique se gère à part ;
    // l'historique (BookingEvent) conserve la trace des versements passés.
    await tx.ticket.deleteMany({ where: { bookingId } })
    await tx.payment.deleteMany({ where: { bookingId } })
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'cancelled', paidAt: null, refundCents: null, refundReason: null },
    })

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
): Promise<{ etaitPlace: boolean; anciensSeatIds: string[]; ancienNombre: number }> {
  if (!Number.isInteger(nouveauNombre) || nouveauNombre < 1 || nouveauNombre > MAX_PARTY_SIZE) {
    throw new Error(`Le nombre de places doit être compris entre 1 et ${MAX_PARTY_SIZE}.`)
  }
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new Error('Demande introuvable.')
    if (!['pending', 'paid', 'placed'].includes(booking.status)) {
      throw new Error('Cette demande est annulée ou expirée.')
    }
    // Une pending dont l'échéance est passée (pas encore balayée par le cron)
    // est traitée comme expirée : sinon on sur-compterait la jauge (son hold
    // n'est plus décompté par computeJauge). Cohérent avec ajouter/émettre.
    if (booking.status === 'pending' && booking.expiresAt && booking.expiresAt <= new Date()) {
      throw new Error('Cette demande est expirée — prolonge-la avant de changer le nombre de places.')
    }
    const ancienNombre = booking.partySize
    if (nouveauNombre === booking.partySize) {
      return { etaitPlace: false, anciensSeatIds: [], ancienNombre }
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
      // Mémoriser où la famille était placée AVANT de supprimer les billets,
      // pour l'afficher en rappel sur l'écran de re-placement.
      const anciens = await tx.ticket.findMany({
        where: { bookingId },
        select: { seatId: true },
      })
      await tx.ticket.deleteMany({ where: { bookingId } })
      await tx.booking.update({
        where: { id: bookingId },
        // Offertes ET enfants bornés au nouveau total (jamais plus que partySize).
        data: {
          partySize: nouveauNombre,
          status: 'paid',
          placedAt: null,
          freeSeats: Math.min(booking.freeSeats, nouveauNombre),
          childCount: Math.min(booking.childCount, nouveauNombre),
        },
      })
      return { etaitPlace: true, anciensSeatIds: anciens.map((t) => t.seatId), ancienNombre }
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        partySize: nouveauNombre,
        freeSeats: Math.min(booking.freeSeats, nouveauNombre),
        childCount: Math.min(booking.childCount, nouveauNombre),
      },
    })
    return { etaitPlace: false, anciensSeatIds: [], ancienNombre }
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
