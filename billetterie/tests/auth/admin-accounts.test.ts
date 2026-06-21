// Tests de lib/auth/admin-accounts.ts (résolution de rôle env+base, CRUD) sur
// une DB SQLite JETABLE dans /tmp. ADMIN_EMAILS est forcé pour le test.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  AdminAccountError,
  createAdminAccount,
  deleteAdminAccount,
  listAdminAccounts,
  resolveAdminRole,
  updateAdminAccountRole,
} from '@/lib/auth/admin-accounts'

const dbFile = `/tmp/billetterie-test-accounts-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient
let envBackup: string | undefined

const ENV_SUPER = 'boss@exemple.fr'

beforeAll(() => {
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = new PrismaClient({ datasources: { db: { url } } })
  envBackup = process.env.ADMIN_EMAILS
  process.env.ADMIN_EMAILS = ENV_SUPER
}, 60_000)

afterAll(async () => {
  await db.$disconnect()
  process.env.ADMIN_EMAILS = envBackup
  for (const suffix of ['', '-journal']) rmSync(dbFile + suffix, { force: true })
})

beforeEach(async () => {
  await db.adminAccount.deleteMany()
})

describe('resolveAdminRole', () => {
  it('un email de ADMIN_EMAILS est super-admin', async () => {
    expect(await resolveAdminRole(db, ENV_SUPER)).toBe('super-admin')
    expect(await resolveAdminRole(db, '  BOSS@Exemple.FR ')).toBe('super-admin')
  })

  it('l’env prime sur la base (jamais rétrogradé)', async () => {
    // Insertion directe (createAdminAccount refuserait un email d'env).
    await db.adminAccount.create({ data: { email: ENV_SUPER, role: 'admin' } })
    expect(await resolveAdminRole(db, ENV_SUPER)).toBe('super-admin')
  })

  it('renvoie le rôle du compte en base', async () => {
    await createAdminAccount(db, 'a@exemple.fr', 'admin')
    await createAdminAccount(db, 'b@exemple.fr', 'super-admin')
    expect(await resolveAdminRole(db, 'a@exemple.fr')).toBe('admin')
    expect(await resolveAdminRole(db, 'B@EXEMPLE.FR')).toBe('super-admin')
  })

  it('renvoie null pour un email inconnu', async () => {
    expect(await resolveAdminRole(db, 'inconnu@exemple.fr')).toBe(null)
  })
})

describe('createAdminAccount', () => {
  it('crée un compte et normalise la casse', async () => {
    await createAdminAccount(db, '  New@Exemple.FR ', 'admin')
    const rows = await listAdminAccounts(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('new@exemple.fr')
    expect(rows[0].role).toBe('admin')
  })

  it('refuse un email déjà super-admin via l’env', async () => {
    await expect(createAdminAccount(db, ENV_SUPER, 'admin')).rejects.toBeInstanceOf(
      AdminAccountError,
    )
  })

  it('refuse un doublon', async () => {
    await createAdminAccount(db, 'dup@exemple.fr', 'admin')
    await expect(createAdminAccount(db, 'DUP@exemple.fr', 'admin')).rejects.toBeInstanceOf(
      AdminAccountError,
    )
  })
})

describe('update / delete', () => {
  it('change le rôle', async () => {
    await createAdminAccount(db, 'c@exemple.fr', 'admin')
    const [row] = await listAdminAccounts(db)
    await updateAdminAccountRole(db, row.id, 'super-admin')
    expect(await resolveAdminRole(db, 'c@exemple.fr')).toBe('super-admin')
  })

  it('supprime un compte', async () => {
    await createAdminAccount(db, 'd@exemple.fr', 'admin')
    const [row] = await listAdminAccounts(db)
    await deleteAdminAccount(db, row.id)
    expect(await listAdminAccounts(db)).toHaveLength(0)
    expect(await resolveAdminRole(db, 'd@exemple.fr')).toBe(null)
  })
})
