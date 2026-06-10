'use server'

import bcrypt from 'bcryptjs'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSession, destroySession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

const loginSchema = z.object({
  email: z.email('Adresse email invalide').max(200),
  password: z.string().min(1, 'Mot de passe requis').max(200),
})

export type LoginState = { error?: string }

export async function seConnecter(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const fwd = (await headers()).get('x-forwarded-for')
  const ip = fwd?.split(',')[0]?.trim() || 'inconnue'
  if (!rateLimit(`login:${ip}`, { limit: 5, windowMs: 15 * 60_000 })) {
    return { error: 'Trop de tentatives, réessayez dans quelques minutes.' }
  }

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  // Message volontairement identique quel que soit l'échec : pas d'énumération
  // des comptes possibles.
  if (!parsed.success) return { error: 'Identifiants invalides.' }

  const admin = await prisma.adminUser.findUnique({
    where: { email: parsed.data.email.toLowerCase().trim() },
  })
  // Compare aussi quand le compte n'existe pas (timing homogène).
  const hash = admin?.passwordHash ?? '$2b$10$invalideinvalideinvalideinvalideinvalideinvalideinv'
  const ok = await bcrypt.compare(parsed.data.password, hash)
  if (!admin || !ok) return { error: 'Identifiants invalides.' }

  await createSession({ adminId: admin.id, email: admin.email })
  redirect('/admin')
}

export async function seDeconnecter(): Promise<void> {
  await destroySession()
  redirect('/admin/login')
}
