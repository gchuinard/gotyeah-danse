// Lookup d'une place par code, sur une DB SQLite ISOLÉE ET JETABLE dans /tmp
// (même pattern que tests/auth/login-code.ts). Vérifie le cadrage par email
// (jamais la place d'un inconnu) et le garde-fou du chiffre de contrôle.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { codePlace } from '@/lib/booking/code-place'
import { trouverPlaceParCode, vuePlaceParQrToken } from '@/lib/booking/place'

const dbFile = `/tmp/billetterie-test-place-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient

const EMAIL = 'marie@exemple.fr'
const NAME = 'Marie Dupont'
const QR = 'qr-marie-r12'

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = new PrismaClient({ datasources: { db: { url } } })

  await db.section.create({ data: { id: 'centre', name: 'Centre', order: 1 } })
  await db.row.create({ data: { id: 'centre-R', sectionId: 'centre', label: 'R', order: 12 } })
  await db.seat.create({
    data: { id: 'centre-R-12', rowId: 'centre-R', number: 12, indexInRow: 6, x: 0, y: 0, angle: 0 },
  })
  const rep = await db.representation.create({
    data: { id: 'rep-test', title: 'Samedi 20h30', startsAt: new Date('2026-06-27T18:30:00Z') },
  })
  const booking = await db.booking.create({
    data: {
      representationId: rep.id,
      name: NAME,
      email: EMAIL,
      phone: '0612345678',
      partySize: 1,
      status: 'placed',
      publicToken: 'tok-marie',
    },
  })
  await db.ticket.create({
    data: { bookingId: booking.id, representationId: rep.id, seatId: 'centre-R-12', qrToken: QR },
  })
}, 60_000)

afterAll(async () => {
  await db.$disconnect()
  for (const suffix of ['', '-journal']) rmSync(dbFile + suffix, { force: true })
})

describe('trouverPlaceParCode', () => {
  it('email + bon code → la place (rang, numéro, prénom du proprio)', async () => {
    const r = await trouverPlaceParCode(db, EMAIL, codePlace(QR, NAME))
    expect(r.type).toBe('trouvee')
    if (r.type === 'trouvee') {
      expect(r.vue.rang).toBe('R')
      expect(r.vue.place).toBe(12)
      expect(r.vue.proprioPrenom).toBe('Marie')
      expect(r.vue.qrToken).toBe(QR)
    }
  })

  it('tolère casse et séparateurs sur l’email et le code', async () => {
    const code = codePlace(QR, NAME)
    const sale = `${code.slice(0, 2)} ${code.slice(2)}`.toLowerCase()
    expect((await trouverPlaceParCode(db, '  Marie@Exemple.FR ', sale)).type).toBe('trouvee')
  })

  it('bon code mais MAUVAIS email → introuvable (cadrage par email)', async () => {
    expect((await trouverPlaceParCode(db, 'autre@exemple.fr', codePlace(QR, NAME))).type).toBe(
      'introuvable',
    )
  })

  it('faute de frappe sur un chiffre → introuvable (chiffre de contrôle)', async () => {
    const code = codePlace(QR, NAME)
    const faux = code.slice(0, 5) + String((Number(code[5]) + 1) % 10)
    expect((await trouverPlaceParCode(db, EMAIL, faux)).type).toBe('introuvable')
  })

  it('email ou code vide → introuvable', async () => {
    expect((await trouverPlaceParCode(db, '', codePlace(QR, NAME))).type).toBe('introuvable')
    expect((await trouverPlaceParCode(db, EMAIL, '')).type).toBe('introuvable')
  })
})

describe('vuePlaceParQrToken', () => {
  it('qrToken connu → la place (lien direct, sans email ni code)', async () => {
    const vue = await vuePlaceParQrToken(db, QR)
    expect(vue).not.toBeNull()
    expect(vue?.rang).toBe('R')
    expect(vue?.place).toBe(12)
    expect(vue?.proprioPrenom).toBe('Marie')
  })

  it('qrToken inconnu → null', async () => {
    expect(await vuePlaceParQrToken(db, 'qr-inexistant')).toBeNull()
  })
})
