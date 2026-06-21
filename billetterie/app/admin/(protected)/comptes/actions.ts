'use server'

// Gestion des comptes admin + PIN scan — super-admin uniquement. Même pattern
// que les autres actions admin : requireSuperAdmin + zod + redirect ?ok=/?err=.
// Anti-lockout : un super-admin ne peut pas retirer SON PROPRE accès s'il n'est
// pas couvert par ADMIN_EMAILS (.env) — l'env, lui, reste toujours super-admin.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  AdminAccountError,
  createAdminAccount,
  deleteAdminAccount,
  updateAdminAccountRole,
} from '@/lib/auth/admin-accounts'
import { isAdminEmail } from '@/lib/auth/admin-emails'
import { requireSuperAdmin } from '@/lib/auth/require-admin'
import { SCAN_PIN_RE, clearScanPin, setScanPin } from '@/lib/auth/scan-pin'
import { prisma } from '@/lib/db'

const idSchema = z.string().min(1).max(64)
const roleSchema = z.enum(['super-admin', 'admin'])
const emailSchema = z.email().max(200)
const pinSchema = z.string().regex(SCAN_PIN_RE)

function versListe(type: 'ok' | 'err', message: string): never {
  redirect(`/admin/comptes?${new URLSearchParams({ [type]: message })}`)
}

function rafraichir() {
  revalidatePath('/admin/comptes')
}

export async function ajouterCompte(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const email = emailSchema.safeParse(formData.get('email'))
  const role = roleSchema.safeParse(formData.get('role'))
  if (!email.success) versListe('err', 'Adresse email invalide.')
  if (!role.success) versListe('err', 'Rôle invalide.')

  try {
    await createAdminAccount(prisma, email.data, role.data)
  } catch (e) {
    if (e instanceof AdminAccountError) versListe('err', e.message)
    throw e
  }
  rafraichir()
  versListe('ok', `Compte ${email.data} ajouté (${role.data}).`)
}

export async function changerRole(formData: FormData): Promise<void> {
  const session = await requireSuperAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  const role = roleSchema.safeParse(formData.get('role'))
  if (!id.success) versListe('err', 'Compte introuvable.')
  if (!role.success) versListe('err', 'Rôle invalide.')

  const account = await prisma.adminAccount.findUnique({ where: { id: id.data } })
  if (!account) versListe('err', 'Compte introuvable.')

  // Anti-lockout : pas d'auto-rétrogradation si non couvert par l'env.
  if (
    account.email === session.email &&
    role.data !== 'super-admin' &&
    !isAdminEmail(account.email)
  ) {
    versListe('err', 'Vous ne pouvez pas retirer votre propre accès super-admin.')
  }

  await updateAdminAccountRole(prisma, account.id, role.data)
  rafraichir()
  versListe('ok', `Rôle de ${account.email} : ${role.data}.`)
}

export async function supprimerCompte(formData: FormData): Promise<void> {
  const session = await requireSuperAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  if (!id.success) versListe('err', 'Compte introuvable.')

  const account = await prisma.adminAccount.findUnique({ where: { id: id.data } })
  if (!account) versListe('err', 'Compte introuvable.')

  if (account.email === session.email && !isAdminEmail(account.email)) {
    versListe('err', 'Vous ne pouvez pas supprimer votre propre compte.')
  }

  await deleteAdminAccount(prisma, account.id)
  rafraichir()
  versListe('ok', `Compte ${account.email} supprimé.`)
}

export async function definirPinScan(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const pin = pinSchema.safeParse(formData.get('pin'))
  if (!pin.success) versListe('err', 'Le PIN doit comporter 4 à 8 chiffres.')

  await setScanPin(prisma, pin.data)
  rafraichir()
  versListe('ok', 'PIN du mode scan enregistré.')
}

export async function desactiverPinScan(): Promise<void> {
  await requireSuperAdmin()
  await clearScanPin(prisma)
  rafraichir()
  versListe('ok', 'Accès scan désactivé (aucun PIN).')
}
