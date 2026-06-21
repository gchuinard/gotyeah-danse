// Comptes admin gérés en base, par-dessus la liste blanche ADMIN_EMAILS du
// .env. Règle d'or anti-lockout : un email présent dans ADMIN_EMAILS est
// TOUJOURS super-admin, quoi qu'il y ait en base. Les comptes en base servent
// à ajouter des admins (ou super-admins) sans toucher au .env ni redéployer.

import type { PrismaClient } from '@prisma/client'
import { adminEmails, isAdminEmail } from './admin-emails'
import type { AccountRole, Role } from './roles'

const norm = (email: string) => email.trim().toLowerCase()

// Rôle effectif d'un email : env (super-admin garanti) puis compte en base.
// null = email non autorisé.
export async function resolveAdminRole(db: PrismaClient, email: string): Promise<Role | null> {
  const cleanEmail = norm(email)
  if (isAdminEmail(cleanEmail)) return 'super-admin'

  const account = await db.adminAccount.findUnique({ where: { email: cleanEmail } })
  if (!account) return null
  return account.role === 'super-admin' ? 'super-admin' : 'admin'
}

export type AdminAccountRow = {
  id: string
  email: string
  role: AccountRole
  createdAt: Date
}

export async function listAdminAccounts(db: PrismaClient): Promise<AdminAccountRow[]> {
  const rows = await db.adminAccount.findMany({ orderBy: { createdAt: 'asc' } })
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role === 'super-admin' ? 'super-admin' : 'admin',
    createdAt: r.createdAt,
  }))
}

// Erreurs « métier » remontées proprement à l'UI (≠ bug serveur).
export class AdminAccountError extends Error {}

export async function createAdminAccount(
  db: PrismaClient,
  email: string,
  role: AccountRole,
): Promise<void> {
  const cleanEmail = norm(email)
  // Inutile (et trompeur) de créer un compte pour un super-admin du .env :
  // l'env fait déjà foi et écrase tout.
  if (isAdminEmail(cleanEmail)) {
    throw new AdminAccountError(
      'Cette adresse est déjà super-admin via la configuration serveur (ADMIN_EMAILS).',
    )
  }
  const existing = await db.adminAccount.findUnique({ where: { email: cleanEmail } })
  if (existing) {
    throw new AdminAccountError('Un compte existe déjà pour cette adresse.')
  }
  try {
    await db.adminAccount.create({ data: { email: cleanEmail, role } })
  } catch (e) {
    // Course entre deux super-admins : la contrainte d'unicité (P2002) gagne.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
      throw new AdminAccountError('Un compte existe déjà pour cette adresse.')
    }
    throw e
  }
}

export async function updateAdminAccountRole(
  db: PrismaClient,
  id: string,
  role: AccountRole,
): Promise<void> {
  await db.adminAccount.update({ where: { id }, data: { role } })
}

export async function deleteAdminAccount(db: PrismaClient, id: string): Promise<void> {
  await db.adminAccount.delete({ where: { id } })
}

// Super-admins « garantis » du .env (lecture seule dans l'UI).
export function envSuperAdmins(): string[] {
  return adminEmails()
}
