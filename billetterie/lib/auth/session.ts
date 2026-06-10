// Sessions admin « maison » — pas de NextAuth, conformément au pattern du
// projet : cookie httpOnly signé HMAC-SHA256, payload JSON en clair (id +
// email + expiration), aucune donnée sensible dedans. La signature empêche
// la forge ; le secret vit dans SESSION_SECRET.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const SESSION_COOKIE = 'session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 jours

export type AdminSession = { adminId: string; email: string }

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum) — voir .env.example')
  }
  return s
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url')

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function signSessionToken(session: AdminSession, now = Date.now()): string {
  const payload = b64url(JSON.stringify({ ...session, exp: now + SESSION_TTL_MS }))
  return `${payload}.${sign(payload)}`
}

// Pure (pas de cookies()) : utilisée aussi par proxy.ts.
export function verifySessionToken(token: string | undefined, now = Date.now()): AdminSession | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = Buffer.from(sign(payload))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AdminSession & { exp: number }
    if (typeof data.exp !== 'number' || data.exp < now) return null
    if (typeof data.adminId !== 'string' || typeof data.email !== 'string') return null
    return { adminId: data.adminId, email: data.email }
  } catch {
    return null
  }
}

export async function createSession(admin: AdminSession): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, signSessionToken(admin), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export async function getSession(): Promise<AdminSession | null> {
  const store = await cookies()
  return verifySessionToken(store.get(SESSION_COOKIE)?.value)
}
