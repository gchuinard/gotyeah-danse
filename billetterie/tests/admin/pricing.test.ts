// Prix unitaire global (lib/admin/pricing) sur une DB SQLite jetable dans /tmp.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  clearTicketPrice,
  getTicketPriceCents,
  setTicketPriceCents,
  TICKET_PRICE_KEY,
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
  it('null tant qu’aucun prix n’est défini', async () => {
    expect(await getTicketPriceCents(db)).toBeNull()
  })

  it('set puis get (upsert relançable)', async () => {
    await setTicketPriceCents(db, 1200)
    expect(await getTicketPriceCents(db)).toBe(1200)
    await setTicketPriceCents(db, 1500)
    expect(await getTicketPriceCents(db)).toBe(1500)
  })

  it('clear remet à null', async () => {
    await setTicketPriceCents(db, 1200)
    await clearTicketPrice(db)
    expect(await getTicketPriceCents(db)).toBeNull()
  })

  it('valeur illisible en base → null (pas de prix deviné)', async () => {
    await db.setting.create({ data: { key: TICKET_PRICE_KEY, value: 'abc' } })
    expect(await getTicketPriceCents(db)).toBeNull()
  })

  it('refuse un prix négatif ou non entier', async () => {
    await expect(setTicketPriceCents(db, -5)).rejects.toThrow()
    await expect(setTicketPriceCents(db, 12.5)).rejects.toThrow()
  })
})
