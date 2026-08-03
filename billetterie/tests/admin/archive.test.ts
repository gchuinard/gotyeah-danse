// Règle d'archivage (lib/admin/archive.ts) sur une DB SQLite ISOLÉE ET JETABLE
// dans /tmp — jamais prisma/dev.db (URL passée explicitement au client ET à
// `prisma db push`).
//
// Ce fichier verrouille les deux moitiés de la règle :
//  1. le GEL      — demandeGelee / assertDemandeModifiable(ParToken) : les
//     actions mutantes refusent une demande dont la rep est archivée ;
//  2. le PÉRIMÈTRE — les filtres DEMANDES_ACTIVES / DEMANDES_ARCHIVEES, joués
//     dans de VRAIES requêtes Prisma (un filtre de relation sur SQLite : c'est
//     ce qui fait disparaître les demandes de /admin/demandes et du cron).

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  assertDemandeModifiable,
  assertDemandeModifiableParToken,
  demandeGelee,
  demandesVivantesParRepresentation,
  DEMANDES_ACTIVES,
  DEMANDES_ARCHIVEES,
  MESSAGE_GELEE,
  MESSAGE_GELEE_PUBLIC,
} from '@/lib/admin/archive'

const dbFile = `/tmp/billetterie-test-archive-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient

// Compteur monotone → publicToken unique (@unique).
let seq = 0
const uid = () => `${++seq}`

async function makeRep(data: Record<string, unknown> = {}) {
  return db.representation.create({
    data: {
      title: 'Samedi 20h30',
      startsAt: new Date('2026-06-27T18:30:00Z'),
      ...data,
    },
  })
}

const ARCHIVEE = { archivedAt: new Date('2026-07-01T09:00:00Z'), archivedBy: 'chef@ecole.fr' }

async function makeBooking(representationId: string, status = 'pending', partySize = 2) {
  return db.booking.create({
    data: {
      representationId,
      name: 'Famille Test',
      email: `famille-${uid()}@exemple.fr`,
      phone: '0600000000',
      partySize,
      status,
      publicToken: `tok-${process.pid}-${uid()}`,
    },
  })
}

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
  seq = 0
})

describe('demandeGelee / assertDemandeModifiable', () => {
  it('une demande de représentation ACTIVE est modifiable', async () => {
    const rep = await makeRep()
    const booking = await makeBooking(rep.id)

    expect(await demandeGelee(db, booking.id)).toBe(false)
    await expect(assertDemandeModifiable(db, booking.id)).resolves.toBeUndefined()
  })

  it('une demande de représentation ARCHIVÉE est gelée', async () => {
    const rep = await makeRep(ARCHIVEE)
    const booking = await makeBooking(rep.id)

    expect(await demandeGelee(db, booking.id)).toBe(true)
    await expect(assertDemandeModifiable(db, booking.id)).rejects.toThrow(MESSAGE_GELEE)
  })

  it('le gel suit le statut : même une demande annulée d’une rep archivée est gelée', async () => {
    const rep = await makeRep(ARCHIVEE)
    const booking = await makeBooking(rep.id, 'cancelled')
    expect(await demandeGelee(db, booking.id)).toBe(true)
  })

  it('désarchiver DÉGÈLE (l’archivage ne mute rien, il est réversible)', async () => {
    const rep = await makeRep(ARCHIVEE)
    const booking = await makeBooking(rep.id)
    expect(await demandeGelee(db, booking.id)).toBe(true)

    await db.representation.update({
      where: { id: rep.id },
      data: { archivedAt: null, archivedBy: null },
    })

    expect(await demandeGelee(db, booking.id)).toBe(false)
    // La demande est retrouvée telle quelle : rien n'a été muté au passage.
    const apres = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(apres.status).toBe('pending')
  })

  it('demande introuvable → pas gelée (l’appelant lèvera « introuvable » lui-même)', async () => {
    expect(await demandeGelee(db, 'booking-fantome')).toBe(false)
    await expect(assertDemandeModifiable(db, 'booking-fantome')).resolves.toBeUndefined()
  })
})

describe('assertDemandeModifiableParToken (actions côté famille)', () => {
  it('laisse passer une demande de représentation active', async () => {
    const rep = await makeRep()
    const booking = await makeBooking(rep.id)
    await expect(
      assertDemandeModifiableParToken(db, booking.publicToken),
    ).resolves.toBeUndefined()
  })

  it('refuse avec le message FAMILLE (sans jargon admin) si la rep est archivée', async () => {
    const rep = await makeRep(ARCHIVEE)
    const booking = await makeBooking(rep.id)
    await expect(assertDemandeModifiableParToken(db, booking.publicToken)).rejects.toThrow(
      MESSAGE_GELEE_PUBLIC,
    )
  })

  it('token inconnu → pas de refus d’archive (message d’erreur propre à l’appelant)', async () => {
    await expect(assertDemandeModifiableParToken(db, 'token-fantome')).resolves.toBeUndefined()
  })
})

describe('filtres DEMANDES_ACTIVES / DEMANDES_ARCHIVEES', () => {
  it('partitionnent les demandes selon l’état de LEUR représentation', async () => {
    const active = await makeRep({ title: 'Édition 2026' })
    const archivee = await makeRep({ title: 'Édition 2025', ...ARCHIVEE })
    const a1 = await makeBooking(active.id)
    const a2 = await makeBooking(active.id, 'placed')
    const v1 = await makeBooking(archivee.id, 'placed')

    const actives = await db.booking.findMany({ where: DEMANDES_ACTIVES, select: { id: true } })
    const archivees = await db.booking.findMany({
      where: DEMANDES_ARCHIVEES,
      select: { id: true },
    })

    expect(actives.map((b) => b.id).sort()).toEqual([a1.id, a2.id].sort())
    expect(archivees.map((b) => b.id)).toEqual([v1.id])
    // Partition stricte : aucune demande dans les deux, aucune oubliée.
    expect(actives.length + archivees.length).toBe(await db.booking.count())
  })

  it('se composent avec les autres critères (statut, comme dans /admin/demandes)', async () => {
    const active = await makeRep()
    const archivee = await makeRep(ARCHIVEE)
    const attendue = await makeBooking(active.id, 'pending')
    await makeBooking(active.id, 'placed')
    await makeBooking(archivee.id, 'pending')

    const res = await db.booking.findMany({
      where: { ...DEMANDES_ACTIVES, status: 'pending' },
      select: { id: true },
    })
    expect(res.map((b) => b.id)).toEqual([attendue.id])
  })

  it('s’appliquent aussi en écriture de masse (updateMany — c’est le cas du cron)', async () => {
    const active = await makeRep()
    const archivee = await makeRep(ARCHIVEE)
    const bookingActif = await makeBooking(active.id, 'pending')
    const bookingGele = await makeBooking(archivee.id, 'pending')

    const { count } = await db.booking.updateMany({
      where: { status: 'pending', ...DEMANDES_ACTIVES },
      data: { status: 'expired' },
    })

    expect(count).toBe(1)
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingActif.id } })).status).toBe(
      'expired',
    )
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingGele.id } })).status).toBe(
      'pending',
    )
  })
})

describe('demandesVivantesParRepresentation', () => {
  it('compte les demandes en attente / à placer / placées, par représentation', async () => {
    const repA = await makeRep({ title: 'A' })
    const repB = await makeRep({ title: 'B' })
    await makeBooking(repA.id, 'pending')
    await makeBooking(repA.id, 'paid')
    await makeBooking(repA.id, 'placed')
    await makeBooking(repB.id, 'pending')

    const parRep = await demandesVivantesParRepresentation(db)
    expect(parRep.get(repA.id)).toBe(3)
    expect(parRep.get(repB.id)).toBe(1)
  })

  it('ignore les annulées et les expirées (elles ne gèlent rien)', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'cancelled')
    await makeBooking(rep.id, 'expired')

    const parRep = await demandesVivantesParRepresentation(db)
    // Aucune ligne du tout : le message d'archivage affichera « 0 en cours ».
    expect(parRep.get(rep.id)).toBeUndefined()
  })

  it('sans aucune demande, renvoie une carte vide', async () => {
    await makeRep()
    expect((await demandesVivantesParRepresentation(db)).size).toBe(0)
  })
})
