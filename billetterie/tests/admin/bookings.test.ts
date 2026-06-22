// Tests de lib/admin/bookings.ts sur une DB SQLite ISOLÉE ET JETABLE dans
// /tmp — on ne touche JAMAIS à prisma/dev.db : l'URL est passée explicitement
// au client ET à `prisma db push` (env), aucune lecture de .env ne peut fuir.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  ajouterPaiement,
  annulerDemande,
  annulerPaiement,
  changerNombrePlaces,
  definirPlacesOffertes,
  deplacerBillets,
  emettreBillets,
  enregistrerRemboursement,
  prolongerExpiration,
  supprimerPaiement,
} from '@/lib/admin/bookings'

const dbFile = `/tmp/billetterie-test-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient

const DAY_MS = 24 * 60 * 60 * 1000

// Sièges du mini-plan : 1 section, 1 rangée, 8 sièges s1..s8.
const SEAT_IDS = Array.from({ length: 8 }, (_, i) => `s${i + 1}`)

beforeAll(() => {
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = new PrismaClient({ datasources: { db: { url } } })
}, 60_000)

afterAll(async () => {
  await db.$disconnect()
  for (const suffix of ['', '-journal']) rmSync(dbFile + suffix, { force: true })
})

// Seed minimal artisanal, reconstruit avant chaque test (état indépendant).
beforeEach(async () => {
  await db.ticket.deleteMany()
  await db.booking.deleteMany()
  await db.seatOverride.deleteMany()
  await db.seat.deleteMany()
  await db.row.deleteMany()
  await db.section.deleteMany()
  await db.representation.deleteMany()

  await db.representation.create({
    data: { id: 'rep-test', title: 'Samedi 20h30', startsAt: new Date('2026-06-20T18:30:00Z') },
  })
  await db.section.create({ data: { id: 'centre', name: 'centre', order: 1 } })
  await db.row.create({ data: { id: 'centre-A', sectionId: 'centre', label: 'A', order: 0 } })
  await db.seat.createMany({
    data: SEAT_IDS.map((id, i) => ({
      id,
      rowId: 'centre-A',
      number: i + 1,
      indexInRow: i,
      x: i,
      y: 0,
      angle: 0,
    })),
  })
})

let compteur = 0
async function creerBooking(status: string, partySize = 2, expiresAt: Date | null = null) {
  compteur += 1
  return db.booking.create({
    data: {
      representationId: 'rep-test',
      name: `Test ${compteur}`,
      email: `test${compteur}@example.com`,
      phone: '0600000000',
      partySize,
      status,
      publicToken: `token-${process.pid}-${compteur}`,
      expiresAt: expiresAt ?? new Date(Date.now() + 14 * DAY_MS),
      paidAt: status === 'paid' || status === 'placed' ? new Date() : null,
    },
  })
}

async function remis(db: PrismaClient, bookingId: string) {
  const agg = await db.payment.aggregate({ where: { bookingId }, _sum: { amountCents: true } })
  return agg._sum.amountCents ?? 0
}

describe('ajouterPaiement', () => {
  it('1er versement : pending → paid, paidAt posé, versement créé', async () => {
    const booking = await creerBooking('pending')
    const res = await ajouterPaiement(db, booking.id, { method: 'cheque', amountCents: 2550 }, null)
    expect(res.etaitPending).toBe(true)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('paid')
    expect(apres.paidAt).toBeInstanceOf(Date)
    expect(await remis(db, booking.id)).toBe(2550)
  })

  it('plusieurs versements s’accumulent ; soldée seulement quand net ≥ dû', async () => {
    // partySize 4, prix 1000 → dû 4000.
    const booking = await creerBooking('pending', 4)
    const a = await ajouterPaiement(db, booking.id, { method: 'cheque', amountCents: 2000 }, 1000)
    expect(a.nowSoldee).toBe(false) // acompte
    const b = await ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 2000 }, 1000)
    expect(b.nowSoldee).toBe(true) // soldée
    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(2)
    expect(await remis(db, booking.id)).toBe(4000)
  })

  it('prix non défini → nowSoldee vrai dès le 1er versement (ancien flux)', async () => {
    const booking = await creerBooking('pending', 4)
    const res = await ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 500 }, null)
    expect(res.nowSoldee).toBe(true)
  })

  it('versement sur une demande placée non réglée : reste placée, paidAt posé', async () => {
    const booking = await creerBooking('pending', 1)
    await emettreBillets(db, booking.id, ['s1']) // placée, non réglée
    const res = await ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 1600 }, null)
    expect(res.etaitPlace).toBe(true)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('placed')
    expect(apres.paidAt).toBeInstanceOf(Date)
    expect(await remis(db, booking.id)).toBe(1600)
  })

  it('enregistre la date de dépôt et la référence (chèque échelonné)', async () => {
    const booking = await creerBooking('pending', 2)
    const dep = new Date('2026-07-15T12:00:00Z')
    await ajouterPaiement(
      db,
      booking.id,
      { method: 'cheque', amountCents: 1200, depositOn: dep, reference: 'n°42' },
      null,
    )
    const p = await db.payment.findFirstOrThrow({ where: { bookingId: booking.id } })
    expect(p.depositOn?.toISOString()).toBe(dep.toISOString())
    expect(p.reference).toBe('n°42')
  })

  it('refuse un montant nul ou négatif', async () => {
    const booking = await creerBooking('pending')
    await expect(
      ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 0 }, null),
    ).rejects.toThrow(/supérieur à 0/)
  })

  it('refuse une pending expirée', async () => {
    const booking = await creerBooking('pending', 2, new Date(Date.now() - DAY_MS))
    await expect(
      ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 100 }, null),
    ).rejects.toThrow(/expirée/)
  })
})

describe('supprimerPaiement', () => {
  it('supprime un versement ; le dernier supprimé efface le règlement (paid → pending)', async () => {
    const booking = await creerBooking('pending', 2)
    await ajouterPaiement(db, booking.id, { method: 'cheque', amountCents: 1000 }, null)
    const p = await db.payment.findFirstOrThrow({ where: { bookingId: booking.id } })
    await supprimerPaiement(db, booking.id, p.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('pending')
    expect(apres.paidAt).toBeNull()
    expect(await remis(db, booking.id)).toBe(0)
  })

  it('garde un versement restant (reste « à placer »)', async () => {
    const booking = await creerBooking('pending', 4)
    await ajouterPaiement(db, booking.id, { method: 'cheque', amountCents: 2000 }, 1000)
    await ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 2000 }, 1000)
    const p = await db.payment.findFirstOrThrow({ where: { bookingId: booking.id } })
    await supprimerPaiement(db, booking.id, p.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('paid')
    expect(apres.paidAt).toBeInstanceOf(Date)
    expect(await remis(db, booking.id)).toBe(2000)
  })

  it('une placée garde ses sièges même si le dernier versement est supprimé', async () => {
    const booking = await creerBooking('pending', 1)
    await emettreBillets(db, booking.id, ['s1'])
    await ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 1600 }, null)
    const p = await db.payment.findFirstOrThrow({ where: { bookingId: booking.id } })
    await supprimerPaiement(db, booking.id, p.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('placed')
    expect(apres.paidAt).toBeNull()
    expect(await db.ticket.count({ where: { bookingId: booking.id } })).toBe(1)
  })

  it('retire un remboursement devenu supérieur au reçu restant', async () => {
    const booking = await creerBooking('pending', 4)
    await ajouterPaiement(db, booking.id, { method: 'cheque', amountCents: 3000 }, null)
    await ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 1000 }, null)
    await enregistrerRemboursement(db, booking.id, { refundCents: 2000 })
    // On supprime le gros versement → reçu = 1000 < remboursé 2000 → remboursé retiré.
    const gros = await db.payment.findFirstOrThrow({ where: { bookingId: booking.id, amountCents: 3000 } })
    await supprimerPaiement(db, booking.id, gros.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.refundCents).toBeNull()
    expect(await remis(db, booking.id)).toBe(1000)
  })

  it('refuse un versement d’une autre demande', async () => {
    const a = await creerBooking('pending', 1)
    await ajouterPaiement(db, a.id, { method: 'especes', amountCents: 500 }, null)
    const pA = await db.payment.findFirstOrThrow({ where: { bookingId: a.id } })
    const b = await creerBooking('pending', 1)
    await expect(supprimerPaiement(db, b.id, pA.id)).rejects.toThrow(/introuvable/)
  })
})

describe('annulerPaiement', () => {
  async function payee(status: 'pending' | 'placed' = 'pending') {
    const booking = await creerBooking('pending', 1)
    if (status === 'placed') await emettreBillets(db, booking.id, ['s1'])
    await ajouterPaiement(db, booking.id, { method: 'especes', amountCents: 1600 }, null)
    return booking
  }

  it('une demande « à placer » repasse en attente, versements supprimés', async () => {
    const booking = await payee('pending')
    await annulerPaiement(db, booking.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('pending')
    expect(apres.paidAt).toBeNull()
    expect(apres.expiresAt).toBeInstanceOf(Date)
    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(0)
  })

  it('une demande placée GARDE ses sièges et redevient non réglée', async () => {
    const booking = await payee('placed')
    await annulerPaiement(db, booking.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('placed')
    expect(apres.paidAt).toBeNull()
    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(0)
    expect(await db.ticket.count({ where: { bookingId: booking.id } })).toBe(1)
  })

  it('refuse une demande non réglée', async () => {
    const booking = await creerBooking('pending', 1)
    await expect(annulerPaiement(db, booking.id)).rejects.toThrow(/pas marquée payée/)
  })

  it('efface aussi un remboursement éventuel', async () => {
    const booking = await creerBooking('pending')
    await ajouterPaiement(db, booking.id, { method: 'cheque', amountCents: 4000 }, null)
    await enregistrerRemboursement(db, booking.id, { refundCents: 1500, refundReason: 'place retirée' })
    await annulerPaiement(db, booking.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.refundCents).toBeNull()
    expect(apres.refundReason).toBeNull()
  })
})

describe('changerNombrePlaces', () => {
  it('refuse une pending expirée (évite le sur-comptage de jauge)', async () => {
    const booking = await creerBooking('pending', 2, new Date(Date.now() - DAY_MS))
    await expect(changerNombrePlaces(db, booking.id, 4)).rejects.toThrow(/expirée/)
  })

  it('borne les places offertes au nouveau nombre quand on réduit', async () => {
    const booking = await creerBooking('pending', 4)
    await definirPlacesOffertes(db, booking.id, 3)
    await changerNombrePlaces(db, booking.id, 2)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.partySize).toBe(2)
    expect(apres.freeSeats).toBe(2)
  })
})

describe('definirPlacesOffertes', () => {
  it('définit les places offertes', async () => {
    const booking = await creerBooking('pending', 4)
    await definirPlacesOffertes(db, booking.id, 1)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.freeSeats).toBe(1)
  })

  it('refuse plus de places offertes que de places', async () => {
    const booking = await creerBooking('pending', 2)
    await expect(definirPlacesOffertes(db, booking.id, 3)).rejects.toThrow(/Au plus 2/)
  })

  it('refuse un nombre négatif', async () => {
    const booking = await creerBooking('pending', 2)
    await expect(definirPlacesOffertes(db, booking.id, -1)).rejects.toThrow(/invalide/)
  })
})

describe('enregistrerRemboursement', () => {
  async function payee(amountCents = 4000) {
    const booking = await creerBooking('pending')
    await ajouterPaiement(db, booking.id, { method: 'especes', amountCents }, null)
    return booking
  }

  it('enregistre un remboursement (montant + motif)', async () => {
    const booking = await payee(4000)
    await enregistrerRemboursement(db, booking.id, { refundCents: 1500, refundReason: 'place retirée' })
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.refundCents).toBe(1500)
    expect(apres.refundReason).toBe('place retirée')
  })

  it('refuse un remboursement supérieur au total reçu', async () => {
    const booking = await payee(4000)
    await expect(
      enregistrerRemboursement(db, booking.id, { refundCents: 5000 }),
    ).rejects.toThrow(/dépasser/)
  })

  it('refuse un montant nul ou négatif', async () => {
    const booking = await payee(4000)
    await expect(enregistrerRemboursement(db, booking.id, { refundCents: 0 })).rejects.toThrow(
      /supérieur à 0/,
    )
  })

  it('refuse si la demande n’a aucun versement', async () => {
    const booking = await creerBooking('pending')
    await expect(
      enregistrerRemboursement(db, booking.id, { refundCents: 1000 }),
    ).rejects.toThrow(/versement/)
  })
})

describe('emettreBillets', () => {
  it('émet les billets : statut placed, tickets créés, qrTokens uniques', async () => {
    const booking = await creerBooking('paid', 3)
    const resultat = await emettreBillets(db, booking.id, ['s1', 's2', 's3'])

    expect(resultat.id).toBe(booking.id)
    expect(resultat.tickets).toHaveLength(3)
    expect(resultat.representation.title).toBe('Samedi 20h30')
    expect(resultat.tickets.map((t) => t.seat.number).sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect(resultat.tickets[0].seat.row.label).toBe('A')
    expect(resultat.tickets[0].seat.row.section.name).toBe('centre')

    const tokens = resultat.tickets.map((t) => t.qrToken)
    expect(new Set(tokens).size).toBe(3)

    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('placed')
    expect(apres.placedAt).toBeInstanceOf(Date)
  })

  it('refuse si seatIds.length ≠ partySize', async () => {
    const booking = await creerBooking('paid', 4)
    await expect(emettreBillets(db, booking.id, ['s1', 's2'])).rejects.toThrow(
      /exactement 4 siège/,
    )
    expect(await db.ticket.count()).toBe(0)
  })

  it('place une demande en attente (paiement plus tard) : placed, paidAt reste null', async () => {
    const booking = await creerBooking('pending', 1)
    const resultat = await emettreBillets(db, booking.id, ['s1'])
    expect(resultat.tickets).toHaveLength(1)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('placed')
    expect(apres.paidAt).toBeNull()
  })

  it('refuse de placer une demande annulée', async () => {
    const booking = await creerBooking('cancelled', 1)
    await expect(emettreBillets(db, booking.id, ['s1'])).rejects.toThrow(/en attente ou payée/)
  })

  it('refuse un siège bloqué par un override', async () => {
    await db.seatOverride.create({
      data: { representationId: 'rep-test', seatId: 's2', reason: 'console_son' },
    })
    const booking = await creerBooking('paid', 2)
    await expect(emettreBillets(db, booking.id, ['s1', 's2'])).rejects.toThrow(/bloqué/)
  })

  it('place sur un siège « réservé PMR » et consomme la réservation', async () => {
    await db.seatOverride.create({
      data: { representationId: 'rep-test', seatId: 's2', reason: 'pmr' },
    })
    const booking = await creerBooking('paid', 2)
    await emettreBillets(db, booking.id, ['s1', 's2'])
    expect(await db.ticket.count({ where: { bookingId: booking.id } })).toBe(2)
    // L'override PMR du siège attribué a été levé.
    expect(await db.seatOverride.count({ where: { seatId: 's2' } })).toBe(0)
  })

  it('siège déjà ticketé → erreur propre, rien créé (course entre bénévoles)', async () => {
    const premier = await creerBooking('paid', 1)
    await emettreBillets(db, premier.id, ['s5'])

    const second = await creerBooking('paid', 2)
    await expect(emettreBillets(db, second.id, ['s5', 's6'])).rejects.toThrow(
      "Un de ces sièges vient d'être pris, recharge le plan",
    )

    // Transaction annulée : pas de ticket orphelin, statut inchangé.
    expect(await db.ticket.count({ where: { bookingId: second.id } })).toBe(0)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: second.id } })
    expect(apres.status).toBe('paid')
  })
})

describe('deplacerBillets', () => {
  it('supprime les anciens tickets et recrée avec des qrTokens TOUS nouveaux', async () => {
    const booking = await creerBooking('paid', 2)
    const avant = await emettreBillets(db, booking.id, ['s1', 's2'])
    const anciensTokens = new Set(avant.tickets.map((t) => t.qrToken))

    const apres = await deplacerBillets(db, booking.id, ['s3', 's4'])

    expect(apres.tickets).toHaveLength(2)
    expect(apres.tickets.map((t) => t.seat.number).sort((a, b) => a - b)).toEqual([3, 4])
    for (const t of apres.tickets) expect(anciensTokens.has(t.qrToken)).toBe(false)

    // Les anciens tickets n'existent plus du tout (QR invalides).
    expect(await db.ticket.count({ where: { bookingId: booking.id } })).toBe(2)
    expect(await db.ticket.count({ where: { seatId: { in: ['s1', 's2'] } } })).toBe(0)
  })

  it('les sièges actuels du booking comptent comme libres pour lui-même', async () => {
    const booking = await creerBooking('paid', 2)
    const avant = await emettreBillets(db, booking.id, ['s1', 's2'])

    // Déplacement chevauchant : s2 reste, s3 remplace s1.
    const apres = await deplacerBillets(db, booking.id, ['s2', 's3'])
    expect(apres.tickets.map((t) => t.seat.number).sort((a, b) => a - b)).toEqual([2, 3])
    // Même le siège conservé porte un NOUVEAU qrToken.
    const anciensTokens = new Set(avant.tickets.map((t) => t.qrToken))
    for (const t of apres.tickets) expect(anciensTokens.has(t.qrToken)).toBe(false)
  })

  it('refuse un siège occupé par un autre booking', async () => {
    const autre = await creerBooking('paid', 1)
    await emettreBillets(db, autre.id, ['s8'])
    const booking = await creerBooking('paid', 1)
    await emettreBillets(db, booking.id, ['s1'])

    await expect(deplacerBillets(db, booking.id, ['s8'])).rejects.toThrow(/vient d'être pris/)
    // Rollback : le booking garde son siège d'origine.
    const tickets = await db.ticket.findMany({ where: { bookingId: booking.id } })
    expect(tickets.map((t) => t.seatId)).toEqual(['s1'])
  })

  it('refuse une demande non placée', async () => {
    const booking = await creerBooking('paid', 1)
    await expect(deplacerBillets(db, booking.id, ['s1'])).rejects.toThrow(
      "Cette demande n'est pas encore placée.",
    )
  })
})

describe('annulerDemande', () => {
  it('annule une placed : tickets supprimés, sièges libérés', async () => {
    const booking = await creerBooking('paid', 2)
    await emettreBillets(db, booking.id, ['s1', 's2'])

    const infos = await annulerDemande(db, booking.id)
    expect(infos).toMatchObject({ partySize: 2, representation: { title: 'Samedi 20h30' } })
    expect(infos.email).toContain('@example.com')

    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('cancelled')
    expect(await db.ticket.count({ where: { bookingId: booking.id } })).toBe(0)

    // Les sièges libérés sont réutilisables immédiatement.
    const suivant = await creerBooking('paid', 2)
    await expect(emettreBillets(db, suivant.id, ['s1', 's2'])).resolves.toBeTruthy()
  })

  it('annule une pending sans tickets', async () => {
    const booking = await creerBooking('pending', 3)
    await annulerDemande(db, booking.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('cancelled')
  })

  it('purge les versements et remet le règlement à zéro (caisse propre)', async () => {
    const booking = await creerBooking('pending', 2)
    await ajouterPaiement(db, booking.id, { method: 'cheque', amountCents: 2400 }, null)
    await enregistrerRemboursement(db, booking.id, { refundCents: 400 })
    await annulerDemande(db, booking.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('cancelled')
    expect(apres.paidAt).toBeNull()
    expect(apres.refundCents).toBeNull()
    expect(apres.refundReason).toBeNull()
    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(0)
  })

  it('refuse une demande déjà annulée', async () => {
    const booking = await creerBooking('cancelled')
    await expect(annulerDemande(db, booking.id)).rejects.toThrow('Cette demande est déjà annulée.')
  })
})

describe('prolongerExpiration', () => {
  it('repousse expiresAt à maintenant + 14 jours, même sur une pending expirée', async () => {
    const booking = await creerBooking('pending', 2, new Date(Date.now() - DAY_MS))
    const avant = Date.now()
    await prolongerExpiration(db, booking.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    const attendu = avant + 14 * DAY_MS
    expect(apres.expiresAt!.getTime()).toBeGreaterThanOrEqual(attendu - 1000)
    expect(apres.expiresAt!.getTime()).toBeLessThanOrEqual(attendu + 60_000)
  })

  it('refuse une demande non pending', async () => {
    const booking = await creerBooking('placed')
    await expect(prolongerExpiration(db, booking.id)).rejects.toThrow(/en attente/)
  })
})
