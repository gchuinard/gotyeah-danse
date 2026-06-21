// Tests de lib/auth/scan-pin.ts sur une DB SQLite JETABLE dans /tmp.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { clearScanPin, isScanPinSet, setScanPin, verifyScanPin } from '@/lib/auth/scan-pin'

const dbFile = `/tmp/billetterie-test-scanpin-${process.pid}.db`
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

describe('scan-pin', () => {
  it('aucun PIN au départ : isScanPinSet false, verify false', async () => {
    expect(await isScanPinSet(db)).toBe(false)
    expect(await verifyScanPin(db, '1234')).toBe(false)
  })

  it('setScanPin → vérifie le bon PIN, refuse les autres', async () => {
    await setScanPin(db, '4271')
    expect(await isScanPinSet(db)).toBe(true)
    expect(await verifyScanPin(db, '4271')).toBe(true)
    expect(await verifyScanPin(db, '0000')).toBe(false)
    expect(await verifyScanPin(db, '42710')).toBe(false) // longueur différente
  })

  it('ne stocke pas le PIN en clair (hash)', async () => {
    await setScanPin(db, '123456')
    const row = await db.setting.findUnique({ where: { key: 'scan_pin_hash' } })
    expect(row?.value).toBeTruthy()
    expect(row?.value).not.toContain('123456')
  })

  it('redéfinir le PIN remplace l’ancien (upsert)', async () => {
    await setScanPin(db, '1111')
    await setScanPin(db, '2222')
    expect(await verifyScanPin(db, '1111')).toBe(false)
    expect(await verifyScanPin(db, '2222')).toBe(true)
    expect(await db.setting.count()).toBe(1)
  })

  it('clearScanPin désactive l’accès', async () => {
    await setScanPin(db, '9876')
    await clearScanPin(db)
    expect(await isScanPinSet(db)).toBe(false)
    expect(await verifyScanPin(db, '9876')).toBe(false)
  })
})
