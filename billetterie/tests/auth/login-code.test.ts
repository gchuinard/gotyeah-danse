// Tests de lib/auth/login-code.ts sur une DB SQLite ISOLÉE ET JETABLE dans
// /tmp — on ne touche JAMAIS à prisma/dev.db (même pattern que tests/admin/).

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createLoginCode, MAX_ATTEMPTS, verifyLoginCode } from '@/lib/auth/login-code'

const dbFile = `/tmp/billetterie-test-login-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient

const NOW = new Date('2026-06-10T09:00:00Z')
const EMAIL = 'admin@exemple.fr'

// Toujours faux, quel que soit le code tiré : dernier chiffre décalé.
const mauvaisCode = (code: string) => code.slice(0, 5) + String((Number(code[5]) + 1) % 10)

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
  await db.loginCode.deleteMany()
})

describe('createLoginCode', () => {
  it('retourne un code à 6 chiffres et ne stocke que son hash', async () => {
    const code = await createLoginCode(db, EMAIL, NOW)
    expect(code).toMatch(/^\d{6}$/)
    const rows = await db.loginCode.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].codeHash).not.toContain(code)
    expect(rows[0].email).toBe(EMAIL)
  })

  it('normalise la casse de l’email', async () => {
    const code = await createLoginCode(db, '  Admin@Exemple.FR ', NOW)
    expect(await verifyLoginCode(db, EMAIL, code, NOW)).toBe(true)
  })

  it('invalide le code précédent quand on en demande un nouveau', async () => {
    const ancien = await createLoginCode(db, EMAIL, NOW)
    const nouveau = await createLoginCode(db, EMAIL, NOW)
    expect(await verifyLoginCode(db, EMAIL, ancien, NOW)).toBe(false)
    expect(await verifyLoginCode(db, EMAIL, nouveau, NOW)).toBe(true)
  })

  it('purge les codes périmés des autres adresses au passage', async () => {
    await createLoginCode(db, 'autre@exemple.fr', new Date(NOW.getTime() - 60 * 60_000))
    await createLoginCode(db, EMAIL, NOW)
    const emails = (await db.loginCode.findMany()).map((r) => r.email)
    expect(emails).toEqual([EMAIL])
  })
})

describe('verifyLoginCode', () => {
  it('accepte le bon code une seule fois (usage unique)', async () => {
    const code = await createLoginCode(db, EMAIL, NOW)
    expect(await verifyLoginCode(db, EMAIL, code, NOW)).toBe(true)
    expect(await verifyLoginCode(db, EMAIL, code, NOW)).toBe(false)
  })

  it('refuse un mauvais code et le bon code après expiration (10 min)', async () => {
    const code = await createLoginCode(db, EMAIL, NOW)
    expect(await verifyLoginCode(db, EMAIL, mauvaisCode(code), NOW)).toBe(false)
    const apres = new Date(NOW.getTime() + 11 * 60_000)
    expect(await verifyLoginCode(db, EMAIL, code, apres)).toBe(false)
  })

  it('refuse un code valide présenté pour une autre adresse', async () => {
    const code = await createLoginCode(db, EMAIL, NOW)
    expect(await verifyLoginCode(db, 'autre@exemple.fr', code, NOW)).toBe(false)
  })

  it(`tue le code après ${MAX_ATTEMPTS} échecs, même si on finit par donner le bon`, async () => {
    const code = await createLoginCode(db, EMAIL, NOW)
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(await verifyLoginCode(db, EMAIL, mauvaisCode(code), NOW)).toBe(false)
    }
    expect(await verifyLoginCode(db, EMAIL, code, NOW)).toBe(false)
  })
})
