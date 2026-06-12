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
  annulerDemande,
  deplacerBillets,
  emettreBillets,
  marquerPayee,
  prolongerExpiration,
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

describe('marquerPayee', () => {
  it('passe une pending non expirée en paid avec paidAt', async () => {
    const booking = await creerBooking('pending')
    await marquerPayee(db, booking.id)
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('paid')
    expect(apres.paidAt).toBeInstanceOf(Date)
  })

  it('enregistre le règlement (méthode + montant en centimes) quand fourni', async () => {
    const booking = await creerBooking('pending')
    await marquerPayee(db, booking.id, { paymentMethod: 'cheque', amountCents: 2550 })
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.paymentMethod).toBe('cheque')
    expect(apres.amountCents).toBe(2550)
  })

  it('refuse une demande non pending', async () => {
    const booking = await creerBooking('paid')
    await expect(marquerPayee(db, booking.id)).rejects.toThrow(
      "Cette demande n'est pas en attente de paiement.",
    )
  })

  it('refuse une pending expirée', async () => {
    const booking = await creerBooking('pending', 2, new Date(Date.now() - DAY_MS))
    await expect(marquerPayee(db, booking.id)).rejects.toThrow(/expirée/)
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

  it('refuse une demande non payée', async () => {
    const booking = await creerBooking('pending', 1)
    await expect(emettreBillets(db, booking.id, ['s1'])).rejects.toThrow(
      "Cette demande n'est pas marquée payée.",
    )
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
