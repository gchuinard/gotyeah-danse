// Tests de lib/admin/cron.ts sur une DB SQLite ISOLÉE ET JETABLE dans
// /tmp — on ne touche JAMAIS à prisma/dev.db : l'URL est passée explicitement
// au client ET à `prisma db push` (env), aucune lecture de .env ne peut fuir.
//
// Le sender est un vi.fn injecté : aucun e-mail réel, on vérifie QUI est
// relancé et que remindedAt n'est posé qu'après un envoi réussi.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { expirerDemandes, relancerDemandes, type ReminderBooking } from '@/lib/admin/cron'

const dbFile = `/tmp/billetterie-test-cron-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient

const DAY_MS = 24 * 60 * 60 * 1000

// `now` fixe injecté dans les jobs : les âges des demandes sont déterministes.
const NOW = new Date('2026-06-10T09:00:00Z')

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

beforeEach(async () => {
  await db.booking.deleteMany()
  await db.representation.deleteMany()
  await db.representation.create({
    data: { id: 'rep-test', title: 'Samedi 20h30', startsAt: new Date('2026-06-20T18:30:00Z') },
  })
  // Édition précédente, ARCHIVÉE : ses demandes sont gelées, le cron doit les
  // ignorer (ne surtout pas relancer une famille sur un spectacle clôturé).
  await db.representation.create({
    data: {
      id: 'rep-archivee',
      title: 'Samedi 20h30 (2025)',
      startsAt: new Date('2025-06-21T18:30:00Z'),
      archivedAt: new Date('2025-07-01T09:00:00Z'),
      archivedBy: 'chef@ecole.fr',
    },
  })
})

let compteur = 0
async function creerBooking(
  status: string,
  options: {
    ageJours?: number
    expiresAt?: Date | null
    remindedAt?: Date | null
    representationId?: string
  } = {},
) {
  compteur += 1
  const ageJours = options.ageJours ?? 1
  const createdAt = new Date(NOW.getTime() - ageJours * DAY_MS)
  return db.booking.create({
    data: {
      representationId: options.representationId ?? 'rep-test',
      name: `Test ${compteur}`,
      email: `test${compteur}@example.com`,
      phone: '0600000000',
      partySize: 2,
      status,
      publicToken: `token-cron-${process.pid}-${compteur}`,
      createdAt,
      // Par défaut : non expirée (créée + 14 jours, toujours dans le futur
      // pour les âges testés). `null` explicite accepté.
      expiresAt:
        options.expiresAt !== undefined
          ? options.expiresAt
          : new Date(createdAt.getTime() + 14 * DAY_MS),
      remindedAt: options.remindedAt ?? null,
      paidAt: status === 'paid' || status === 'placed' ? createdAt : null,
    },
  })
}

async function statutDe(id: string): Promise<string> {
  const b = await db.booking.findUniqueOrThrow({ where: { id } })
  return b.status
}

describe('expirerDemandes', () => {
  it("expire la pending échue, pas la pending future ni les autres statuts", async () => {
    const echue = await creerBooking('pending', { expiresAt: new Date(NOW.getTime() - DAY_MS) })
    const future = await creerBooking('pending', { expiresAt: new Date(NOW.getTime() + DAY_MS) })
    const paidEchue = await creerBooking('paid', { expiresAt: new Date(NOW.getTime() - DAY_MS) })
    const placed = await creerBooking('placed')
    const cancelled = await creerBooking('cancelled', {
      expiresAt: new Date(NOW.getTime() - DAY_MS),
    })

    const count = await expirerDemandes(db, NOW)

    expect(count).toBe(1)
    expect(await statutDe(echue.id)).toBe('expired')
    expect(await statutDe(future.id)).toBe('pending')
    expect(await statutDe(paidEchue.id)).toBe('paid')
    expect(await statutDe(placed.id)).toBe('placed')
    expect(await statutDe(cancelled.id)).toBe('cancelled')
  })

  it("ignore une pending sans date d'expiration", async () => {
    const sansDate = await creerBooking('pending', { expiresAt: null })
    expect(await expirerDemandes(db, NOW)).toBe(0)
    expect(await statutDe(sansDate.id)).toBe('pending')
  })

  it('est idempotent : le deuxième passage retourne 0', async () => {
    await creerBooking('pending', { expiresAt: new Date(NOW.getTime() - DAY_MS) })
    expect(await expirerDemandes(db, NOW)).toBe(1)
    expect(await expirerDemandes(db, NOW)).toBe(0)
  })

  it('laisse INTACTE une pending échue d’une représentation ARCHIVÉE', async () => {
    const gelee = await creerBooking('pending', {
      representationId: 'rep-archivee',
      expiresAt: new Date(NOW.getTime() - DAY_MS),
    })
    const active = await creerBooking('pending', { expiresAt: new Date(NOW.getTime() - DAY_MS) })

    expect(await expirerDemandes(db, NOW)).toBe(1)
    expect(await statutDe(gelee.id)).toBe('pending') // gelée par l'archivage
    expect(await statutDe(active.id)).toBe('expired')
  })
})

describe('relancerDemandes', () => {
  const senderOk = () => vi.fn<(b: ReminderBooking) => Promise<boolean>>(async () => true)

  it('relance la pending de 8 jours, pas les autres', async () => {
    const huitJours = await creerBooking('pending', { ageJours: 8 })
    await creerBooking('pending', { ageJours: 3 }) // trop récente
    await creerBooking('pending', {
      ageJours: 20,
      expiresAt: new Date(NOW.getTime() - DAY_MS), // expirée par date
    })
    await creerBooking('expired', { ageJours: 20 }) // expirée par statut
    await creerBooking('pending', {
      ageJours: 9,
      remindedAt: new Date(NOW.getTime() - DAY_MS), // déjà relancée
    })

    const send = senderOk()
    const resultat = await relancerDemandes(db, send, NOW)

    expect(resultat).toEqual({ envoyees: 1, echecs: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        email: huitJours.email,
        partySize: 2,
        publicToken: huitJours.publicToken,
        representation: expect.objectContaining({ title: 'Samedi 20h30' }),
      }),
    )

    const apres = await db.booking.findUniqueOrThrow({ where: { id: huitJours.id } })
    expect(apres.remindedAt).toBeInstanceOf(Date)
  })

  it('ne relance JAMAIS une demande d’une représentation ARCHIVÉE', async () => {
    await creerBooking('pending', { representationId: 'rep-archivee', ageJours: 8 })
    const send = senderOk()

    expect(await relancerDemandes(db, send, NOW)).toEqual({ envoyees: 0, echecs: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it('sender qui retourne false → remindedAt RESTE null, compté en échec', async () => {
    const booking = await creerBooking('pending', { ageJours: 8 })
    const send = vi.fn<(b: ReminderBooking) => Promise<boolean>>(async () => false)

    expect(await relancerDemandes(db, send, NOW)).toEqual({ envoyees: 0, echecs: 1 })

    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.remindedAt).toBeNull()

    // L'échec est retenté au passage suivant.
    expect(await relancerDemandes(db, senderOk(), NOW)).toEqual({ envoyees: 1, echecs: 0 })
  })

  it('sender qui jette → remindedAt RESTE null, compté en échec', async () => {
    const booking = await creerBooking('pending', { ageJours: 8 })
    const send = vi.fn<(b: ReminderBooking) => Promise<boolean>>(async () => {
      throw new Error('Brevo en rade')
    })

    expect(await relancerDemandes(db, send, NOW)).toEqual({ envoyees: 0, echecs: 1 })
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.remindedAt).toBeNull()
  })

  it('est idempotent : le deuxième passage ne renvoie rien', async () => {
    await creerBooking('pending', { ageJours: 8 })
    expect(await relancerDemandes(db, senderOk(), NOW)).toEqual({ envoyees: 1, echecs: 0 })

    const send = senderOk()
    expect(await relancerDemandes(db, send, NOW)).toEqual({ envoyees: 0, echecs: 0 })
    expect(send).not.toHaveBeenCalled()
  })
})
