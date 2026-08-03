// Jauge d'une représentation, sur une DB SQLite ISOLÉE ET JETABLE dans /tmp
// (même pattern que tests/booking/place.test.ts). On vérifie ce que CONSOMME la
// jauge : sièges actifs (total − overrides) − billets émis − Σ partySize des
// demandes pending/paid NON expirées. Les demandes cancelled/expired et les
// demandes expirées par date ne consomment rien ; les demandes placed comptent
// via leurs billets (pas via leur partySize).

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { computeJauge, representationsOuvertes } from '@/lib/jauge'

// Nom UNIQUE (jauge + pid) → zéro collision avec les autres tests / agents.
const dbFile = `/tmp/billetterie-test-jauge-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient

// Plan FIXE (semé une fois) : la capacité = nombre total de sièges, car
// computeJauge compte db.seat.count() GLOBALEMENT (les sièges sont partagés
// entre toutes les représentations).
const SEAT_IDS = Array.from({ length: 10 }, (_, i) => `centre-A-${String(i + 1).padStart(2, '0')}`)
const CAPACITE = SEAT_IDS.length // 10

// Dates repères : la valeur par défaut de `now` (≈ 2026) tombe entre les deux.
const PASSE = new Date('2020-01-01T00:00:00Z')
const FUTUR = new Date('2030-01-01T00:00:00Z')

// Compteur monotone → tokens uniques (publicToken / qrToken sont @unique).
let seq = 0
const uid = () => `${++seq}`

async function makeRep(data: Record<string, unknown> = {}) {
  return db.representation.create({
    data: {
      title: 'Représentation test',
      startsAt: new Date('2026-06-27T18:30:00Z'),
      ...data,
    },
  })
}

async function makeBooking(
  representationId: string,
  status: string,
  partySize: number,
  data: Record<string, unknown> = {},
) {
  return db.booking.create({
    data: {
      representationId,
      name: 'Famille Test',
      email: 'test@exemple.fr',
      phone: '0600000000',
      partySize,
      status,
      publicToken: `tok-${uid()}`,
      ...data,
    },
  })
}

async function makeTicket(booking: { id: string; representationId: string }, seatId: string) {
  return db.ticket.create({
    data: {
      bookingId: booking.id,
      representationId: booking.representationId,
      seatId,
      qrToken: `qr-${uid()}`,
    },
  })
}

async function makeOverride(representationId: string, seatId: string, reason = 'console_son') {
  return db.seatOverride.create({ data: { representationId, seatId, reason } })
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = new PrismaClient({ datasources: { db: { url } } })

  await db.section.create({ data: { id: 'centre', name: 'Centre', order: 1 } })
  await db.row.create({ data: { id: 'centre-A', sectionId: 'centre', label: 'A', order: 0 } })
  for (let i = 0; i < SEAT_IDS.length; i++) {
    await db.seat.create({
      data: { id: SEAT_IDS[i], rowId: 'centre-A', number: i + 1, indexInRow: i, x: 0, y: 0, angle: 0 },
    })
  }
}, 60_000)

// Remise à zéro du dynamique entre chaque test (ordre FK : billets → overrides →
// demandes → représentations). Le plan (section/rangée/sièges) reste intact.
beforeEach(async () => {
  await db.ticket.deleteMany()
  await db.seatOverride.deleteMany()
  await db.booking.deleteMany()
  await db.representation.deleteMany()
})

afterAll(async () => {
  await db.$disconnect()
  for (const suffix of ['', '-journal']) rmSync(dbFile + suffix, { force: true })
})

describe('computeJauge', () => {
  it('salle vide (aucune demande / billet / blocage) → jauge = capacité totale', async () => {
    const rep = await makeRep()
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE)
  })

  it('une demande pending consomme son partySize', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'pending', 3)
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE - 3)
  })

  it('une demande paid consomme son partySize', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'paid', 2)
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE - 2)
  })

  it('une demande cancelled ne consomme rien', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'cancelled', 4)
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE)
  })

  it('une demande au statut expired ne consomme rien', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'expired', 4)
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE)
  })

  it('une demande placed ne compte PAS via partySize (le compteur ignore placed)', async () => {
    // placed sans billet : ni le compteur pending/paid ni les tickets ne la
    // voient → jauge inchangée. (En vrai, placed a toujours des billets.)
    const rep = await makeRep()
    await makeBooking(rep.id, 'placed', 3)
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE)
  })

  it('une demande placed consomme via ses billets (un siège par ticket)', async () => {
    const rep = await makeRep()
    const b = await makeBooking(rep.id, 'placed', 2)
    await makeTicket(b, SEAT_IDS[0])
    await makeTicket(b, SEAT_IDS[1])
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE - 2)
  })

  it('un siège bloqué (SeatOverride) retire une place', async () => {
    const rep = await makeRep()
    await makeOverride(rep.id, SEAT_IDS[9])
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE - 1)
  })

  it('plusieurs sièges bloqués cumulent', async () => {
    const rep = await makeRep()
    await makeOverride(rep.id, SEAT_IDS[7])
    await makeOverride(rep.id, SEAT_IDS[8])
    await makeOverride(rep.id, SEAT_IDS[9])
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE - 3)
  })

  it('une demande pending EXPIRÉE par date (expiresAt passé) ne consomme rien', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'pending', 5, { expiresAt: PASSE })
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE)
  })

  it('une demande pending avec expiresAt futur consomme', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'pending', 5, { expiresAt: FUTUR })
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE - 5)
  })

  it('une demande pending sans expiration (expiresAt null) consomme', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'pending', 5, { expiresAt: null })
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE - 5)
  })

  it('le paramètre `now` décide de l’expiration (expiresAt > now)', async () => {
    const rep = await makeRep()
    const t = new Date('2026-06-27T18:30:00Z')
    await makeBooking(rep.id, 'pending', 4, { expiresAt: t })
    // now AVANT t → encore valide → consomme.
    expect(await computeJauge(db, rep.id, new Date('2026-06-01T00:00:00Z'))).toBe(CAPACITE - 4)
    // now APRÈS t → expirée → ne consomme plus.
    expect(await computeJauge(db, rep.id, new Date('2026-07-01T00:00:00Z'))).toBe(CAPACITE)
  })

  it('combinaison réaliste : overrides + billets + pending/paid, le reste ignoré', async () => {
    const rep = await makeRep()
    await makeOverride(rep.id, SEAT_IDS[9]) // −1 siège bloqué
    const place = await makeBooking(rep.id, 'placed', 2)
    await makeTicket(place, SEAT_IDS[0]) // −1
    await makeTicket(place, SEAT_IDS[1]) // −1 (placed via billets)
    await makeBooking(rep.id, 'pending', 3) // −3
    await makeBooking(rep.id, 'paid', 1) // −1
    await makeBooking(rep.id, 'cancelled', 4) // 0
    await makeBooking(rep.id, 'expired', 2) // 0
    await makeBooking(rep.id, 'pending', 5, { expiresAt: PASSE }) // 0 (expirée)
    // 10 − 1 − 2 − 3 − 1 = 3
    expect(await computeJauge(db, rep.id)).toBe(3)
  })

  it('la jauge n’est PAS bornée : elle peut devenir négative (surréservation)', async () => {
    const rep = await makeRep()
    await makeBooking(rep.id, 'pending', 15) // > capacité
    expect(await computeJauge(db, rep.id)).toBe(CAPACITE - 15) // −5, pas clampé à 0
  })

  it('isolation : demandes / billets / blocages d’une AUTRE représentation n’impactent pas', async () => {
    const repA = await makeRep({ title: 'A' })
    const repB = await makeRep({ title: 'B' })
    // Tout le « bruit » est sur B.
    const bB = await makeBooking(repB.id, 'placed', 1)
    await makeTicket(bB, SEAT_IDS[0])
    await makeBooking(repB.id, 'pending', 4)
    await makeOverride(repB.id, SEAT_IDS[9])
    // A reste à pleine capacité (les sièges sont globaux, mais override/billets/
    // demandes sont cadrés par représentation).
    expect(await computeJauge(db, repA.id)).toBe(CAPACITE)
    expect(await computeJauge(db, repB.id)).toBe(CAPACITE - 1 - 4 - 1) // 4
  })
})

describe('representationsOuvertes', () => {
  it('ne renvoie que les représentations ouvertes (isOpen)', async () => {
    const ouverte = await makeRep({ title: 'Ouverte', isOpen: true })
    const fermee = await makeRep({ title: 'Fermée', isOpen: false })
    const res = await representationsOuvertes(db)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe(ouverte.id)
    expect(res.some((r) => r.id === fermee.id)).toBe(false)
  })

  it('trie par startsAt croissant', async () => {
    await makeRep({ title: 'Samedi', isOpen: true, startsAt: new Date('2026-06-27T18:30:00Z') })
    await makeRep({ title: 'Vendredi', isOpen: true, startsAt: new Date('2026-06-26T18:30:00Z') })
    await makeRep({ title: 'Dimanche', isOpen: true, startsAt: new Date('2026-06-28T18:30:00Z') })
    const res = await representationsOuvertes(db)
    expect(res.map((r) => r.title)).toEqual(['Vendredi', 'Samedi', 'Dimanche'])
  })

  it('attache la jauge calculée à chaque représentation', async () => {
    const rep = await makeRep({ isOpen: true })
    await makeBooking(rep.id, 'pending', 3)
    const res = await representationsOuvertes(db)
    expect(res[0].jauge).toBe(CAPACITE - 3)
  })

  it('une représentation ouverte à jauge ≤ 0 est TOUJOURS renvoyée (le filtre jauge>0 est le job du formulaire, pas de cette fonction)', async () => {
    // Comportement RÉEL du module : il calcule la jauge mais ne filtre pas
    // dessus — c'est le formulaire public qui masque les jauges ≤ 0.
    const rep = await makeRep({ isOpen: true })
    await makeBooking(rep.id, 'pending', CAPACITE) // jauge = 0
    const res = await representationsOuvertes(db)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe(rep.id)
    expect(res[0].jauge).toBe(0)
  })

  it('aucune représentation ouverte → tableau vide', async () => {
    await makeRep({ title: 'Fermée', isOpen: false })
    expect(await representationsOuvertes(db)).toEqual([])
  })

  // Ceinture de sécurité de l'archivage : archiver ferme déjà isOpen, mais une
  // rep archivée restée ouverte en base ne doit JAMAIS revenir côté public.
  it('exclut les représentations ARCHIVÉES, même restées isOpen', async () => {
    const active = await makeRep({ title: 'Active', isOpen: true })
    const archivee = await makeRep({
      title: 'Archivée',
      isOpen: true,
      archivedAt: new Date('2026-07-01T10:00:00Z'),
      archivedBy: 'chef@ecole.fr',
    })
    const res = await representationsOuvertes(db)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe(active.id)
    expect(res.some((r) => r.id === archivee.id)).toBe(false)
  })

  it('propage le paramètre `now` au calcul de jauge', async () => {
    const rep = await makeRep({ isOpen: true })
    await makeBooking(rep.id, 'pending', 4, { expiresAt: new Date('2026-06-27T18:30:00Z') })
    const avant = await representationsOuvertes(db, new Date('2026-06-01T00:00:00Z'))
    const apres = await representationsOuvertes(db, new Date('2026-07-01T00:00:00Z'))
    expect(avant[0].jauge).toBe(CAPACITE - 4) // demande encore valide
    expect(apres[0].jauge).toBe(CAPACITE) // demande expirée → libérée
  })
})
