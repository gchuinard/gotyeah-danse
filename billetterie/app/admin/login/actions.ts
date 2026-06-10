'use server'

// Login admin sans mot de passe : email (sur liste blanche ADMIN_EMAILS)
// → code à 6 chiffres envoyé par email → session. La réponse à la demande
// de code est identique que l'email soit autorisé ou non (pas d'énumération).

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { isAdminEmail } from '@/lib/auth/admin-emails'
import { createLoginCode, verifyLoginCode } from '@/lib/auth/login-code'
import { createSession, destroySession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { sendLoginCodeEmail } from '@/lib/email/login'

const emailSchema = z.object({
  email: z.email('Adresse email invalide').max(200),
})

const codeSchema = z.object({
  email: z.email().max(200),
  code: z.string().regex(/^\d{6}$/, 'Le code comporte 6 chiffres'),
})

export type LoginState = {
  step: 'email' | 'code'
  email?: string
  error?: string
  info?: string
}

async function clientIp(): Promise<string> {
  const fwd = (await headers()).get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || 'inconnue'
}

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

  // Réponse identique que l'email soit sur la liste blanche ou non.
  if (isAdminEmail(email)) {
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

  // La liste blanche est re-vérifiée ici : un code resté en base ne sert à
  // rien si l'adresse a été retirée du .env entre-temps.
  const ok = isAdminEmail(email) && (await verifyLoginCode(prisma, email, parsed.data.code))
  if (!ok) {
    return { step: 'code', email, error: 'Code invalide ou expiré.' }
  }

  await createSession({ adminId: email, email })
  redirect('/admin')
}

export async function seDeconnecter(): Promise<void> {
  await destroySession()
  redirect('/admin/login')
}
