'use server'

// Login admin sans mot de passe :
//  - Admin/super-admin : email (autorisé via ADMIN_EMAILS .env OU compte en
//    base) → code à 6 chiffres par email → session. Réponse identique que
//    l'email soit autorisé ou non (anti-énumération).
//  - Scan : prénom + PIN partagé → session de rôle « scan » (sans email).

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { resolveAdminRole } from '@/lib/auth/admin-accounts'
import { createLoginCode, verifyLoginCode } from '@/lib/auth/login-code'
import { homeFor } from '@/lib/auth/roles'
import { SCAN_PIN_RE, verifyScanPin } from '@/lib/auth/scan-pin'
import { createSession, destroySession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { clientIp } from '@/lib/net/client-ip'
import { rateLimit } from '@/lib/rate-limit'
import { sendLoginCodeEmail } from '@/lib/email/login'

const emailSchema = z.object({
  email: z.email('Adresse email invalide').max(200),
})

const codeSchema = z.object({
  email: z.email().max(200),
  code: z.string().regex(/^\d{6}$/, 'Le code comporte 6 chiffres'),
})

const scanSchema = z.object({
  // Prénom : lettres (accents compris), espaces, traits d'union, apostrophes.
  prenom: z
    .string()
    .trim()
    .min(1, 'Indiquez votre prénom')
    .max(60)
    .regex(/^[\p{L}][\p{L} '-]*$/u, 'Prénom invalide'),
  pin: z.string().regex(SCAN_PIN_RE, 'PIN invalide'),
})

export type LoginState = {
  step: 'email' | 'code'
  email?: string
  error?: string
  info?: string
}

export type ScanLoginState = { error?: string }

export async function demanderCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ip = await clientIp()
  if (!rateLimit(`login-code:${ip}`, { limit: 5, windowMs: 15 * 60_000 })) {
    return { step: 'email', error: 'Trop de demandes, réessayez dans quelques minutes.' }
  }

  const parsed = emailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    return { step: 'email', error: 'Adresse email invalide.' }
  }
  const email = parsed.data.email.toLowerCase().trim()

  // Réponse identique que l'email soit autorisé (env ou base) ou non.
  if ((await resolveAdminRole(prisma, email)) !== null) {
    const code = await createLoginCode(prisma, email)
    await sendLoginCodeEmail(email, code)
  }
  return {
    step: 'code',
    email,
    info: 'Si cette adresse est autorisée, un code vient de lui être envoyé.',
  }
}

export async function verifierCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ip = await clientIp()
  if (!rateLimit(`login-verif:${ip}`, { limit: 10, windowMs: 15 * 60_000 })) {
    return { step: 'email', error: 'Trop de tentatives, réessayez dans quelques minutes.' }
  }

  const parsed = codeSchema.safeParse({
    email: formData.get('email'),
    code: formData.get('code'),
  })
  if (!parsed.success) {
    return { step: 'code', email: String(formData.get('email') ?? ''), error: 'Code invalide.' }
  }
  const email = parsed.data.email.toLowerCase().trim()

  // Le rôle est re-résolu ici : un code resté en base ne sert à rien si l'accès
  // a été retiré entre-temps (du .env comme de la base).
  const role = await resolveAdminRole(prisma, email)
  const ok = role !== null && (await verifyLoginCode(prisma, email, parsed.data.code))
  if (!ok || role === null) {
    return { step: 'code', email, error: 'Code invalide ou expiré.' }
  }

  await createSession({ adminId: email, role, email, name: email })
  redirect(homeFor(role))
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // enlève accents (séparés par NFD), espaces, etc.
    .replace(/^-+|-+$/g, '')

export async function connexionScan(
  _prev: ScanLoginState,
  formData: FormData,
): Promise<ScanLoginState> {
  const ip = await clientIp()
  if (!rateLimit(`scan-login:${ip}`, { limit: 10, windowMs: 15 * 60_000 })) {
    return { error: 'Trop de tentatives, réessayez dans quelques minutes.' }
  }

  const parsed = scanSchema.safeParse({
    prenom: formData.get('prenom'),
    pin: formData.get('pin'),
  })
  if (!parsed.success) {
    return { error: 'Prénom ou PIN invalide.' }
  }

  if (!(await verifyScanPin(prisma, parsed.data.pin))) {
    return { error: 'PIN incorrect ou accès scan non configuré.' }
  }

  const prenom = parsed.data.prenom
  await createSession({
    adminId: `scan:${slug(prenom)}`,
    role: 'scan',
    email: null,
    name: prenom,
  })
  redirect('/admin/scan')
}

export async function seDeconnecter(): Promise<void> {
  await destroySession()
  redirect('/admin/login')
}
