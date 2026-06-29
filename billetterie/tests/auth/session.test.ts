// Jetons de session admin « maison » : un payload JSON en base64url + une
// signature HMAC-SHA256. La garantie qui compte : un jeton forgé ou trafiqué
// (signature, expiration, rôle, champs manquants) est rejeté → null, jamais
// accepté en silence. On n'exerce QUE les deux fonctions pures
// (signSessionToken / verifySessionToken) ; createSession/getSession/
// destroySession touchent next/headers et sortent du périmètre.

import { createHmac } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ROLES } from '@/lib/auth/roles'
import { type AdminSession, signSessionToken, verifySessionToken } from '@/lib/auth/session'

// Secrets de test (longueurs garanties via repeat — le code exige ≥ 32 car.).
const SECRET = `session-test-secret-${'x'.repeat(20)}` // 40 caractères
const OTHER_SECRET = `autre-secret-test-${'y'.repeat(20)}` // 38 caractères

const NOW = Date.UTC(2026, 5, 10, 9, 0, 0) // 2026-06-10T09:00:00Z, en ms

// Session de référence (rôle admin, avec email).
const SESSION = {
  adminId: 'adm_1',
  role: 'admin',
  email: 'chef@exemple.fr',
  name: 'Pascale',
} satisfies AdminSession

// Forge un jeton « payload.signature » correctement signé avec `sec`, à partir
// d'un payload arbitraire — seul moyen d'exercer les branches que signSessionToken
// ne peut pas produire (exp manquante/non numérique, payload non-JSON).
function forge(payload: unknown, sec = SECRET): string {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const seg = Buffer.from(raw).toString('base64url')
  const sig = createHmac('sha256', sec).update(seg).digest('base64url')
  return `${seg}.${sig}`
}

// Remplace le dernier caractère par un autre, valide en base64url, même longueur.
const flipLast = (s: string) => s.slice(0, -1) + (s.at(-1) === 'A' ? 'B' : 'A')

let original: string | undefined

beforeAll(() => {
  original = process.env.SESSION_SECRET
})

beforeEach(() => {
  // Chaque test repart d'un secret valide ; ceux qui le modifient n'essaiment pas.
  process.env.SESSION_SECRET = SECRET
})

afterAll(() => {
  if (original === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = original
})

describe('signSessionToken / verifySessionToken — aller-retour', () => {
  it('un jeton signé se relit à l’identique', () => {
    expect(verifySessionToken(signSessionToken(SESSION))).toEqual(SESSION)
  })

  it('accès scan : email null est accepté et préservé', () => {
    const scan = { adminId: 'scan_1', role: 'scan', email: null, name: 'Bénévole' } satisfies AdminSession
    expect(verifySessionToken(signSessionToken(scan))).toEqual(scan)
  })

  it('forme du jeton : payload.signature, deux segments base64url', () => {
    const token = signSessionToken(SESSION)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(token.split('.')).toHaveLength(2)
  })

  it('les trois rôles valides (super-admin, admin, scan) se relisent', () => {
    for (const role of ROLES) {
      const s = { adminId: 'a', role, email: null, name: 'X' } satisfies AdminSession
      expect(verifySessionToken(signSessionToken(s))).toEqual(s)
    }
  })

  it('exp : fixée à 7 jours, valide à l’instant pile, périmée une milliseconde après', () => {
    const token = signSessionToken(SESSION, NOW)
    const exp = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).exp as number
    expect(exp).toBe(NOW + 7 * 24 * 60 * 60 * 1000) // TTL de 7 jours
    expect(verifySessionToken(token, exp)).not.toBeNull() // exp == now → encore valide
    expect(verifySessionToken(token, exp + 1)).toBeNull() // une ms plus tard → périmé
  })
})

describe('verifySessionToken — forme et signature', () => {
  it('jeton absent (undefined) → null', () => {
    expect(verifySessionToken(undefined)).toBeNull()
  })

  it('jetons mal formés → null', () => {
    for (const bad of ['', 'sanspoint', '.sig', 'payload.', '..']) {
      expect(verifySessionToken(bad)).toBeNull()
    }
  })

  it('signature falsifiée (même longueur) → null', () => {
    const [payload, sig] = signSessionToken(SESSION).split('.')
    expect(verifySessionToken(`${payload}.${flipLast(sig)}`)).toBeNull()
  })

  it('signature tronquée (longueur différente) → null', () => {
    const token = signSessionToken(SESSION)
    expect(verifySessionToken(token.slice(0, -1))).toBeNull()
  })

  it('payload trafiqué → null (la signature ne colle plus)', () => {
    const [payload, sig] = signSessionToken(SESSION).split('.')
    expect(verifySessionToken(`${flipLast(payload)}.${sig}`)).toBeNull()
  })

  it('jeton signé avec un autre secret → null', () => {
    const token = signSessionToken(SESSION) // signé avec SECRET
    process.env.SESSION_SECRET = OTHER_SECRET // on change de secret côté vérif
    expect(verifySessionToken(token)).toBeNull()
  })
})

describe('verifySessionToken — payload invalide', () => {
  it('garde-fou : un payload complet bien signé se vérifie (harnais forge correct)', () => {
    const ref = forge({ adminId: 'a1', role: 'admin', email: null, name: 'X', exp: NOW + 1000 })
    expect(verifySessionToken(ref, NOW)).toEqual({ adminId: 'a1', role: 'admin', email: null, name: 'X' })
  })

  it('exp manquante → null', () => {
    const token = forge({ adminId: 'a', role: 'admin', email: null, name: 'X' })
    expect(verifySessionToken(token, NOW)).toBeNull()
  })

  it('exp non numérique → null', () => {
    const token = forge({ adminId: 'a', role: 'admin', email: null, name: 'X', exp: 'demain' })
    expect(verifySessionToken(token, NOW)).toBeNull()
  })

  it('payload non-JSON mais correctement signé → null (JSON.parse échoue, capté)', () => {
    expect(verifySessionToken(forge('ceci-nest-pas-du-json-{'), NOW)).toBeNull()
  })

  it('rôle invalide → null', () => {
    const token = signSessionToken({ ...SESSION, role: 'root' } as unknown as AdminSession)
    expect(verifySessionToken(token)).toBeNull()
  })

  it('rôle absent (ancien jeton) → null', () => {
    const token = signSessionToken({ adminId: 'a', email: null, name: 'X' } as unknown as AdminSession)
    expect(verifySessionToken(token)).toBeNull()
  })

  it('adminId manquant → null', () => {
    const token = signSessionToken({ role: 'admin', email: null, name: 'X' } as unknown as AdminSession)
    expect(verifySessionToken(token)).toBeNull()
  })

  it('adminId non-string → null', () => {
    const token = signSessionToken({ adminId: 123, role: 'admin', email: null, name: 'X' } as unknown as AdminSession)
    expect(verifySessionToken(token)).toBeNull()
  })

  it('name manquant → null', () => {
    const token = signSessionToken({ adminId: 'a', role: 'admin', email: null } as unknown as AdminSession)
    expect(verifySessionToken(token)).toBeNull()
  })

  it('email d’un type invalide (nombre) → null', () => {
    const token = signSessionToken({ adminId: 'a', role: 'admin', email: 42, name: 'X' } as unknown as AdminSession)
    expect(verifySessionToken(token)).toBeNull()
  })
})

describe('secret() — via signSessionToken', () => {
  it('SESSION_SECRET manquant → lève', () => {
    delete process.env.SESSION_SECRET
    expect(() => signSessionToken(SESSION)).toThrow(/SESSION_SECRET/)
  })

  it('SESSION_SECRET trop court (< 32) → lève', () => {
    process.env.SESSION_SECRET = 'a'.repeat(31)
    expect(() => signSessionToken(SESSION)).toThrow(/32 caractères/)
  })

  it('SESSION_SECRET de 32 caractères pile → accepté', () => {
    process.env.SESSION_SECRET = 'a'.repeat(32)
    expect(verifySessionToken(signSessionToken(SESSION))).toEqual(SESSION)
  })
})
