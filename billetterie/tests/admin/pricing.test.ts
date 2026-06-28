// Tarifs adulte / enfant (lib/admin/pricing) sur une DB SQLite jetable dans /tmp.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  getTicketPrices,
  setTicketPrices,
  TICKET_PRICE_ADULT_KEY,
  TICKET_PRICE_LEGACY_KEY,
} from '@/lib/admin/pricing'

const dbFile = `/tmp/billetterie-pricing-${process.pid}.db`
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
  await db.setting.deleteMany()
})

describe('pricing', () => {
  it('null tant qu’aucun tarif n’est défini', async () => {
    expect(await getTicketPrices(db)).toEqual({ adultCents: null, childCents: null })
  })

  it('set puis get (upsert relançable)', async () => {
    await setTicketPrices(db, { adultCents: 1200, childCents: 600 })
    expect(await getTicketPrices(db)).toEqual({ adultCents: 1200, childCents: 600 })
    await setTicketPrices(db, { adultCents: 1500, childCents: 800 })
    expect(await getTicketPrices(db)).toEqual({ adultCents: 1500, childCents: 800 })
  })

  it('null sur un tarif l’efface, l’autre reste', async () => {
    await setTicketPrices(db, { adultCents: 1200, childCents: 600 })
    await setTicketPrices(db, { adultCents: 1200, childCents: null })
    expect(await getTicketPrices(db)).toEqual({ adultCents: 1200, childCents: null })
  })

  it('repli : l’ancien prix unique fait office de tarif adulte', async () => {
    await db.setting.create({ data: { key: TICKET_PRICE_LEGACY_KEY, value: '1000' } })
    expect(await getTicketPrices(db)).toEqual({ adultCents: 1000, childCents: null })
  })

  it('enregistrer les tarifs supprime l’ancienne clé unique', async () => {
    await db.setting.create({ data: { key: TICKET_PRICE_LEGACY_KEY, value: '1000' } })
    await setTicketPrices(db, { adultCents: 1300, childCents: 700 })
    expect(await db.setting.findUnique({ where: { key: TICKET_PRICE_LEGACY_KEY } })).toBeNull()
    expect(await getTicketPrices(db)).toEqual({ adultCents: 1300, childCents: 700 })
  })

  it('valeur illisible en base → null (pas de prix deviné)', async () => {
    await db.setting.create({ data: { key: TICKET_PRICE_ADULT_KEY, value: 'abc' } })
    expect((await getTicketPrices(db)).adultCents).toBeNull()
  })

  it('refuse un prix négatif ou non entier', async () => {
    await expect(setTicketPrices(db, { adultCents: -5, childCents: null })).rejects.toThrow()
    await expect(setTicketPrices(db, { adultCents: 12.5, childCents: null })).rejects.toThrow()
  })
})
