// Synchronisation du plan (lib/venue/sync.ts) sur une DB SQLite jetable :
// création, mise à jour, suppression d'orphelins, garde « billets », et
// préservation des bascules amovibles faites dans l'admin.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { VenueConfig } from '@/config/venue'
import { syncPlan } from '@/lib/venue/sync'

const dbFile = `/tmp/billetterie-sync-test-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient

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
  await db.ticket.deleteMany()
  await db.booking.deleteMany()
  await db.seatOverride.deleteMany()
  await db.seat.deleteMany()
  await db.row.deleteMany()
  await db.section.deleteMany()
  await db.representation.deleteMany()
})

// Mini-salle paramétrable : 1 rang continu de `seats` sièges au centre.
function salle(seats: number, removable = false): VenueConfig {
  return {
    name: 'Salle test',
    center: { x: 0, y: 1000 },
    numberingScheme: 'pair-impair',
    rows: [
      {
        label: 'A',
        radius: 500,
        arcs: [
          { section: 'centre', angleStart: -10, angleEnd: 10, seats, ...(removable ? { removable: true } : {}) },
        ],
      },
    ],
  }
}

describe('syncPlan', () => {
  it('crée le plan depuis zéro', async () => {
    const result = await syncPlan(db, salle(6))
    expect(result).toMatchObject({ rows: 1, seats: 6, deleted: 0 })
    expect(await db.seat.count()).toBe(6)
    expect(await db.section.count()).toBe(3)
  })

  it('est relançable (upserts) et supprime les orphelins', async () => {
    await syncPlan(db, salle(6))
    const result = await syncPlan(db, salle(4)) // 2 sièges disparaissent
    expect(result.deleted).toBe(2)
    expect(await db.seat.count()).toBe(4)
  })

  it("nettoie les blocages d'un siège supprimé", async () => {
    await syncPlan(db, salle(6))
    const rep = await db.representation.create({
      data: { id: 'rep-test', title: 'Test', startsAt: new Date() },
    })
    const seat = await db.seat.findFirstOrThrow({ orderBy: { id: 'desc' } })
    await db.seatOverride.create({
      data: { representationId: rep.id, seatId: seat.id, reason: 'test' },
    })
    await syncPlan(db, salle(2))
    expect(await db.seatOverride.count()).toBe(0)
  })

  it('REFUSE de supprimer un siège qui porte un billet', async () => {
    await syncPlan(db, salle(6))
    const rep = await db.representation.create({
      data: { id: 'rep-test', title: 'Test', startsAt: new Date() },
    })
    const seat = await db.seat.findFirstOrThrow({ orderBy: { id: 'desc' } })
    const booking = await db.booking.create({
      data: {
        representationId: rep.id,
        name: 'Famille Test',
        email: 't@example.com',
        phone: '06',
        partySize: 1,
        status: 'placed',
        publicToken: `tok-${process.pid}`,
      },
    })
    await db.ticket.create({
      data: {
        bookingId: booking.id,
        representationId: rep.id,
        seatId: seat.id,
        qrToken: `qr-${process.pid}`,
      },
    })

    await expect(syncPlan(db, salle(2))).rejects.toThrow(/billet/)
    // Rien n'a été supprimé : le plan reste utilisable.
    expect(await db.seat.count()).toBe(6)
  })

  it('préserve les bascules amovibles admin sur les sièges existants', async () => {
    await syncPlan(db, salle(4)) // removable: false partout
    const seat = await db.seat.findFirstOrThrow()
    await db.seat.update({ where: { id: seat.id }, data: { removable: true } }) // retouche admin

    await syncPlan(db, salle(4)) // re-synchro de la même config
    const apres = await db.seat.findUniqueOrThrow({ where: { id: seat.id } })
    expect(apres.removable).toBe(true) // la retouche survit

    // … mais un siège NOUVEAU prend bien le removable de la config.
    await syncPlan(db, salle(6, true))
    const nouveaux = await db.seat.findMany({ where: { id: { not: seat.id } } })
    expect(nouveaux.some((s) => s.removable)).toBe(true)
  })
})
