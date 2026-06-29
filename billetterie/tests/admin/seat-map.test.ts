// Plan de salle d'UNE représentation (lib/admin/seat-map.ts).
//
// Deux fonctions à couvrir :
//  - toSeatStates() est PURE → testée directement (SeatView → SeatState,
//    siège bloqué retiré, free déduit du statut, rowId = section-rowLabel) ;
//  - getSeatMap(db, repId) lit la base → DB SQLite ISOLÉE ET JETABLE dans /tmp
//    (même pattern que tests/booking/place.test.ts). On sème un mini-plan
//    (Section / Row / Seat), deux représentations, des Ticket (occupé) et des
//    SeatOverride (bloqué) pour couvrir tous les états + le cadrage par
//    représentation. On ne touche JAMAIS prisma/dev.db.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getSeatMap, PMR_REASON, toSeatStates, type SeatView } from '@/lib/admin/seat-map'

const dbFile = `/tmp/billetterie-test-seat-map-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient

// Fabrique de SeatView pour les tests purs : des défauts neutres, surchargés
// au cas par cas (id et status obligatoires).
function vue(over: Partial<SeatView> & Pick<SeatView, 'id' | 'status'>): SeatView {
  return {
    x: 0,
    y: 0,
    section: 'centre',
    rowLabel: 'A',
    number: 1,
    indexInRow: 0,
    rowOrder: 0,
    score: 0,
    removable: false,
    ...over,
  }
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = new PrismaClient({ datasources: { db: { url } } })

  // Topologie : 2 sections (gauche order 0, centre order 1), 3 rangées, 4 sièges.
  await db.section.create({ data: { id: 'gauche', name: 'Gauche', order: 0 } })
  await db.section.create({ data: { id: 'centre', name: 'Centre', order: 1 } })

  await db.row.create({ data: { id: 'gauche-A', sectionId: 'gauche', label: 'A', order: 0 } })
  await db.row.create({ data: { id: 'centre-A', sectionId: 'centre', label: 'A', order: 0 } })
  await db.row.create({ data: { id: 'centre-B', sectionId: 'centre', label: 'B', order: 1 } })

  await db.seat.create({
    data: { id: 'gauche-A-01', rowId: 'gauche-A', number: 1, indexInRow: 0, x: 0, y: 0, angle: 0, score: 10 },
  })
  await db.seat.create({
    data: { id: 'centre-A-01', rowId: 'centre-A', number: 1, indexInRow: 0, x: 1, y: 2, angle: 0, score: 50 },
  })
  await db.seat.create({
    data: { id: 'centre-A-02', rowId: 'centre-A', number: 2, indexInRow: 1, x: 3, y: 4, angle: 0, score: 60, removable: true },
  })
  await db.seat.create({
    data: { id: 'centre-B-01', rowId: 'centre-B', number: 1, indexInRow: 0, x: 5, y: 6, angle: 0, score: 30 },
  })

  // Deux représentations : rep-A porte les états, rep-B sert au cadrage.
  const repA = await db.representation.create({
    data: { id: 'rep-A', title: 'Samedi 20h30', startsAt: new Date('2026-06-27T18:30:00Z') },
  })
  const repB = await db.representation.create({
    data: { id: 'rep-B', title: 'Dimanche 15h00', startsAt: new Date('2026-06-28T13:00:00Z') },
  })

  // rep-A : centre-A-01 occupé par une famille PMR, centre-A-02 occupé (non PMR).
  const bkPmr = await db.booking.create({
    data: {
      representationId: repA.id,
      name: 'Famille Martin',
      email: 'martin@exemple.fr',
      phone: '0611111111',
      partySize: 1,
      pmrCount: 1,
      status: 'placed',
      publicToken: 'tok-martin',
    },
  })
  await db.ticket.create({
    data: { bookingId: bkPmr.id, representationId: repA.id, seatId: 'centre-A-01', qrToken: 'qr-martin' },
  })

  const bkStd = await db.booking.create({
    data: {
      representationId: repA.id,
      name: 'Famille Durand',
      email: 'durand@exemple.fr',
      phone: '0622222222',
      partySize: 2,
      status: 'placed',
      publicToken: 'tok-durand',
    },
  })
  await db.ticket.create({
    data: { bookingId: bkStd.id, representationId: repA.id, seatId: 'centre-A-02', qrToken: 'qr-durand' },
  })

  // rep-A : centre-B-01 bloqué (override seul) ; centre-A-01 a EN PLUS un override
  // PMR alors qu'il est déjà ticketé → vérifie que le Ticket prime sur l'override.
  await db.seatOverride.create({
    data: { representationId: repA.id, seatId: 'centre-B-01', reason: 'console_son' },
  })
  await db.seatOverride.create({
    data: { representationId: repA.id, seatId: 'centre-A-01', reason: PMR_REASON },
  })

  // rep-B : gauche-A-01 occupé — siège LIBRE côté rep-A → preuve du cadrage.
  const bkB = await db.booking.create({
    data: {
      representationId: repB.id,
      name: 'Famille Bernard',
      email: 'bernard@exemple.fr',
      phone: '0633333333',
      partySize: 1,
      status: 'placed',
      publicToken: 'tok-bernard',
    },
  })
  await db.ticket.create({
    data: { bookingId: bkB.id, representationId: repB.id, seatId: 'gauche-A-01', qrToken: 'qr-bernard' },
  })
}, 60_000)

afterAll(async () => {
  await db.$disconnect()
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(dbFile + suffix, { force: true })
})

describe('toSeatStates (transformation pure SeatView → SeatState)', () => {
  it('siège libre → free:true, rowId = section-rowLabel, géométrie/extras retirés', () => {
    const out = toSeatStates([
      vue({
        id: 'centre-A-03',
        status: 'libre',
        section: 'centre',
        rowLabel: 'A',
        rowOrder: 2,
        indexInRow: 5,
        number: 7,
        score: 42,
        x: 9,
        y: 9,
        removable: true,
      }),
    ])
    // toEqual vérifie aussi l'ABSENCE de x / y / removable / occupant dans SeatState.
    expect(out).toEqual([
      {
        id: 'centre-A-03',
        section: 'centre',
        rowId: 'centre-A',
        rowLabel: 'A',
        rowOrder: 2,
        indexInRow: 5,
        number: 7,
        score: 42,
        free: true,
      },
    ])
  })

  it('siège occupé → free:false', () => {
    expect(toSeatStates([vue({ id: 's', status: 'occupe' })])[0].free).toBe(false)
  })

  it('siège bloqué → ABSENT du résultat (contrat du moteur de placement)', () => {
    expect(toSeatStates([vue({ id: 's', status: 'bloque' })])).toEqual([])
  })

  it('mélange libre/occupé/bloqué → ne garde que libre+occupé, ordre préservé', () => {
    const out = toSeatStates([
      vue({ id: 'a', status: 'libre' }),
      vue({ id: 'b', status: 'bloque' }),
      vue({ id: 'c', status: 'occupe' }),
    ])
    expect(out.map((s) => s.id)).toEqual(['a', 'c'])
    expect(out.map((s) => s.free)).toEqual([true, false])
  })

  it('rowId concatène la section et le label de rangée', () => {
    const out = toSeatStates([vue({ id: 'g-B-01', status: 'libre', section: 'gauche', rowLabel: 'B' })])
    expect(out[0].rowId).toBe('gauche-B')
  })

  it('tableau vide → tableau vide', () => {
    expect(toSeatStates([])).toEqual([])
  })

  it('ne mute pas son entrée et renvoie de nouveaux objets', () => {
    const input = [vue({ id: 'a', status: 'libre' }), vue({ id: 'b', status: 'bloque' })]
    const snapshot = structuredClone(input)
    const out = toSeatStates(input)
    expect(input).toEqual(snapshot) // entrée intacte
    expect(out).not.toBe(input) // nouveau tableau
    expect(out[0]).not.toBe(input[0]) // nouvel objet
  })
})

describe('getSeatMap (assemblage des états sur DB jetable)', () => {
  let mapA: Record<string, SeatView>

  beforeAll(async () => {
    mapA = Object.fromEntries((await getSeatMap(db, 'rep-A')).map((s) => [s.id, s]))
  })

  it('retourne TOUS les sièges du plan (sièges globaux, non filtrés par représentation)', async () => {
    expect(await getSeatMap(db, 'rep-A')).toHaveLength(4)
  })

  it('trie par rowOrder, puis section (localeCompare), puis indexInRow', async () => {
    const ids = (await getSeatMap(db, 'rep-A')).map((s) => s.id)
    expect(ids).toEqual(['centre-A-01', 'centre-A-02', 'gauche-A-01', 'centre-B-01'])
  })

  it('siège libre → status « libre », sans occupant ni overrideReason', () => {
    const s = mapA['gauche-A-01']
    expect(s.status).toBe('libre')
    expect(s.occupant).toBeUndefined()
    expect(s.occupantPmr).toBeUndefined()
    expect(s.overrideReason).toBeUndefined()
  })

  it('siège occupé (non PMR) → status « occupe » + nom de famille, occupantPmr absent', () => {
    const s = mapA['centre-A-02']
    expect(s.status).toBe('occupe')
    expect(s.occupant).toBe('Famille Durand')
    expect(s.occupantPmr).toBeUndefined()
    expect(s.overrideReason).toBeUndefined()
  })

  it('siège occupé par une famille PMR → occupantPmr:true', () => {
    const s = mapA['centre-A-01']
    expect(s.status).toBe('occupe')
    expect(s.occupant).toBe('Famille Martin')
    expect(s.occupantPmr).toBe(true)
  })

  it('un Ticket prime sur un SeatOverride (siège ticketé ET bloqué → occupe, sans overrideReason)', () => {
    const s = mapA['centre-A-01'] // a un Ticket ET un override PMR
    expect(s.status).toBe('occupe')
    expect(s.overrideReason).toBeUndefined()
  })

  it('siège bloqué (override seul) → status « bloque » + reason, sans occupant', () => {
    const s = mapA['centre-B-01']
    expect(s.status).toBe('bloque')
    expect(s.overrideReason).toBe('console_son')
    expect(s.occupant).toBeUndefined()
    expect(s.occupantPmr).toBeUndefined()
  })

  it('copie fidèlement la géométrie et la topologie du siège', () => {
    expect(mapA['centre-A-02']).toMatchObject({
      x: 3,
      y: 4,
      section: 'centre',
      rowLabel: 'A',
      rowOrder: 0,
      indexInRow: 1,
      number: 2,
      score: 60,
      removable: true,
    })
  })

  it('tickets et overrides sont cadrés par représentation (rep-B ne contamine pas rep-A)', async () => {
    const seatsB = Object.fromEntries((await getSeatMap(db, 'rep-B')).map((s) => [s.id, s]))
    // gauche-A-01 est occupé en rep-B…
    expect(seatsB['gauche-A-01'].status).toBe('occupe')
    expect(seatsB['gauche-A-01'].occupant).toBe('Famille Bernard')
    // …et LIBRE en rep-A ; à l'inverse les états de rep-A n'apparaissent pas en rep-B.
    expect(mapA['gauche-A-01'].status).toBe('libre')
    expect(seatsB['centre-A-01'].status).toBe('libre')
    expect(seatsB['centre-A-02'].status).toBe('libre')
    expect(seatsB['centre-B-01'].status).toBe('libre')
  })

  it('représentation sans aucune donnée → tous les sièges libres', async () => {
    const seats = await getSeatMap(db, 'rep-inexistante')
    expect(seats).toHaveLength(4)
    expect(seats.every((s) => s.status === 'libre')).toBe(true)
  })

  it('intégration getSeatMap → toSeatStates : bloqués retirés, occupés en free:false', async () => {
    const states = toSeatStates(await getSeatMap(db, 'rep-A'))
    // centre-B-01 (bloqué) est absent du contrat moteur.
    expect(states.map((s) => s.id).sort()).toEqual(['centre-A-01', 'centre-A-02', 'gauche-A-01'])
    const byId = Object.fromEntries(states.map((s) => [s.id, s]))
    expect(byId['gauche-A-01'].free).toBe(true)
    expect(byId['centre-A-01'].free).toBe(false)
    expect(byId['centre-A-02'].free).toBe(false)
    expect(byId['centre-A-01'].rowId).toBe('centre-A')
  })
})

describe('PMR_REASON', () => {
  it('vaut exactement « pmr »', () => {
    expect(PMR_REASON).toBe('pmr')
  })
})
