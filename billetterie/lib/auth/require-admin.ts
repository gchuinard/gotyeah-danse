// Garde d'authentification côté rendu et côté actions — défense en
// profondeur : proxy.ts filtre déjà /admin/*, mais chaque page protégée,
// server action et route handler admin re-vérifie la session.

import { redirect } from 'next/navigation'
import { getSession, type AdminSession } from './session'

// Pages et server actions : redirige vers le login si pas de session.
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getSession()
  if (!session) redirect('/admin/login')
  return session
}

// Route handlers (ex. polling du plan) : à l'appelant de renvoyer un 401.
export async function getAdminSession(): Promise<AdminSession | null> {
  return getSession()
}
