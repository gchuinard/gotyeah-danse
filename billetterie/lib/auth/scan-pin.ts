// PIN partagé d'accès au mode scan. Stocké haché (sha256) dans Setting
// "scan_pin_hash" — modifiable par le super-admin depuis /admin/comptes, sans
// redeploy. Tant qu'aucun PIN n'est défini, le login scan est refusé.
// Logique pure DB (client injecté) : testable sur DB jetable.

import { createHash, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

export const SCAN_PIN_KEY = 'scan_pin_hash'
// PIN court mais pas trivial : 4 à 8 chiffres.
export const SCAN_PIN_RE = /^\d{4,8}$/

const hash = (pin: string) => createHash('sha256').update(pin).digest('hex')

export async function isScanPinSet(db: PrismaClient): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: SCAN_PIN_KEY } })
  return Boolean(row?.value)
}

export async function setScanPin(db: PrismaClient, pin: string): Promise<void> {
  const value = hash(pin)
  await db.setting.upsert({
    where: { key: SCAN_PIN_KEY },
    create: { key: SCAN_PIN_KEY, value },
    update: { value },
  })
}

export async function clearScanPin(db: PrismaClient): Promise<void> {
  await db.setting.deleteMany({ where: { key: SCAN_PIN_KEY } })
}

// false si aucun PIN configuré ou PIN incorrect. Comparaison timing-safe.
export async function verifyScanPin(db: PrismaClient, pin: string): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: SCAN_PIN_KEY } })
  if (!row?.value) return false
  const expected = Buffer.from(row.value)
  const received = Buffer.from(hash(pin))
  return expected.length === received.length && timingSafeEqual(expected, received)
}
