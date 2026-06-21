// Gardes d'authentification + autorisation côté rendu et côté actions —
// défense en profondeur : proxy.ts filtre déjà /admin/* (auth seule), mais
// chaque page/action/route admin re-vérifie session ET rôle.
//
//   requireSession    → toute session (scan inclus). Pour le layout, qui
//                       enveloppe AUSSI /admin/scan.
//   requireAdmin      → admin OU super-admin (rejette le rôle scan).
//   requireSuperAdmin → super-admin uniquement.
//   requireScanAccess → tout rôle (scan inclus) — page et API de scan.
//
// Session présente mais rôle insuffisant → redirection vers l'accueil du rôle
// (pas vers le login : la personne EST connectée).

import { redirect } from 'next/navigation'
import { getSession, type AdminSession } from './session'
import { homeFor, type Role } from './roles'

// Les rôles admin/super-admin se connectent toujours par email → email garanti.
export type AdminEmailSession = AdminSession & { email: string }

export async function requireSession(): Promise<AdminSession> {
  const session = await getSession()
  if (!session) redirect('/admin/login')
  return session
}

async function requireWithRoles(allowed: readonly Role[]): Promise<AdminSession> {
  const session = await getSession()
  if (!session) redirect('/admin/login')
  if (!allowed.includes(session.role)) redirect(homeFor(session.role))
  return session
}

// Zones admin générales : tout sauf le rôle scan (donc email toujours présent).
export async function requireAdmin(): Promise<AdminEmailSession> {
  const session = await requireWithRoles(['super-admin', 'admin'])
  if (session.email === null) redirect('/admin/login') // garde-fou : ne devrait pas arriver
  return { ...session, email: session.email }
}

export async function requireSuperAdmin(): Promise<AdminEmailSession> {
  const session = await requireWithRoles(['super-admin'])
  if (session.email === null) redirect('/admin/login')
  return { ...session, email: session.email }
}

export async function requireScanAccess(): Promise<AdminSession> {
  return requireWithRoles(['super-admin', 'admin', 'scan'])
}

// Route handlers : à l'appelant de renvoyer 401/403. Retourne la session ou null.
export async function getAdminSession(): Promise<AdminSession | null> {
  return getSession()
}
