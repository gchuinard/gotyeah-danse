// Global-setup E2E : FORGE les cookies de session admin (un par rôle) et les
// écrit en storageState Playwright — on court-circuite ainsi tout le flux OTP
// Brevo. La forge réplique exactement `signSessionToken` (lib/auth/session.ts) :
// cookie « session » = base64url(JSON {adminId,role,email,name,exp}) + "." +
// HMAC-SHA256(payload, SESSION_SECRET). Le rôle vivant DANS le token (aucune
// relecture DB), n'importe quel rôle est forgeable.

import { createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { E2E_SESSION_SECRET, ROLES_AUTH } from './data'

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const b64url = (s: string) => Buffer.from(s).toString('base64url')

function forgeToken(session: object, now: number): string {
  const payload = b64url(JSON.stringify({ ...session, exp: now + TTL_MS }))
  const signature = createHmac('sha256', E2E_SESSION_SECRET).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

const SESSIONS: Record<keyof typeof ROLES_AUTH, object> = {
  'super-admin': {
    adminId: 'e2e-super',
    role: 'super-admin',
    email: 'superadmin@test.local',
    name: 'superadmin@test.local',
  },
  admin: { adminId: 'e2e-admin', role: 'admin', email: 'admin@test.local', name: 'admin@test.local' },
  scan: { adminId: 'e2e-scan', role: 'scan', email: null, name: 'Bénévole E2E' },
}

export default function globalSetup() {
  const now = Date.now()
  const expiresUnix = Math.floor((now + TTL_MS) / 1000)

  for (const role of Object.keys(ROLES_AUTH) as (keyof typeof ROLES_AUTH)[]) {
    const storageState = {
      cookies: [
        {
          name: 'session',
          value: forgeToken(SESSIONS[role], now),
          domain: 'localhost',
          path: '/',
          expires: expiresUnix,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax' as const,
        },
      ],
      origins: [],
    }
    const abs = path.resolve(process.cwd(), ROLES_AUTH[role])
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, JSON.stringify(storageState, null, 2))
  }
}
