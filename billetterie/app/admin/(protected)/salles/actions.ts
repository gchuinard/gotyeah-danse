'use server'

// Server actions des salles enregistrées (/admin/salles + créateur).
// L'ACTIVATION matérialise le plan immédiatement (lib/venue/sync.ts) :
// plus besoin de reseed ni de rebuild pour changer de salle.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { loadVenueConfig } from '@/lib/venue/load'
import { parseVenueConfig } from '@/lib/venue/schema'
import { syncPlan } from '@/lib/venue/sync'

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)
const nameSchema = z.string().trim().min(1).max(100)

export type SalleResult = { ok: true } | { ok: false; error: string }

function messageErreur(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur est survenue.'
}

function urlListe(cle: 'ok' | 'err', message: string): string {
  return `/admin/salles?${cle}=${encodeURIComponent(message)}`
}

function revalider(): void {
  revalidatePath('/admin/salles')
  revalidatePath('/admin/plan')
  revalidatePath('/admin')
}

// Depuis le créateur de salle : enregistre la config en base (sans l'activer).
export async function enregistrerSalle(input: { name: string; config: unknown }): Promise<SalleResult> {
  await requireAdmin()

  const name = nameSchema.safeParse(input.name)
  if (!name.success) return { ok: false, error: 'Nom de salle invalide.' }

  let configJson: string
  try {
    configJson = JSON.stringify(parseVenueConfig(input.config, 'créateur de salle'))
  } catch (error) {
    return { ok: false, error: messageErreur(error) }
  }

  await prisma.venue.create({ data: { name: name.data, config: configJson } })
  revalidatePath('/admin/salles')
  return { ok: true }
}

// Depuis l'éditeur : met à jour une salle existante (nom + config). Ne touche
// PAS au plan matérialisé — si la salle est active, l'admin « Réapplique le
// plan » explicitement depuis la liste (jamais de demi-édition appliquée).
export async function modifierSalle(input: {
  id: string
  name: string
  config: unknown
}): Promise<SalleResult & { active?: boolean }> {
  await requireAdmin()

  const id = idSchema.safeParse(input.id)
  const name = nameSchema.safeParse(input.name)
  if (!id.success || !name.success) return { ok: false, error: 'Salle ou nom invalide.' }

  let configJson: string
  try {
    configJson = JSON.stringify(parseVenueConfig(input.config, 'éditeur de salle'))
  } catch (error) {
    return { ok: false, error: messageErreur(error) }
  }

  try {
    const venue = await prisma.venue.update({
      where: { id: id.data },
      data: { name: name.data, config: configJson },
    })
    revalidatePath('/admin/salles')
    return { ok: true, active: venue.isActive }
  } catch {
    return { ok: false, error: 'Salle introuvable.' }
  }
}

// Re-synchronise le plan depuis la config de la salle ACTIVE (après une
// modification, ou pour réparer). Mêmes garde-fous que l'activation.
export async function reappliquerPlanAction(): Promise<void> {
  await requireAdmin()
  const active = await prisma.venue.findFirst({ where: { isActive: true } })
  if (!active) redirect(urlListe('err', 'Aucune salle active à réappliquer.'))
  try {
    const config = parseVenueConfig(JSON.parse(active.config), `salle « ${active.name} »`)
    const result = await syncPlan(prisma, config)
    revalider()
    redirect(urlListe('ok', `Plan réappliqué — ${result.seats} places, ${result.rows} rangées.`))
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error
    redirect(urlListe('err', messageErreur(error)))
  }
}

// Active une salle : synchronise le plan PUIS bascule le drapeau. Si la
// synchro échoue (ex. billets sur des sièges disparus), rien ne bascule.
export async function activerSalleAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  if (!id.success) redirect(urlListe('err', 'Identifiant invalide.'))

  const venue = await prisma.venue.findUnique({ where: { id: id.data } })
  if (!venue) redirect(urlListe('err', 'Salle introuvable.'))

  try {
    const config = parseVenueConfig(JSON.parse(venue.config), `salle « ${venue.name} »`)
    const result = await syncPlan(prisma, config)
    await prisma.$transaction([
      prisma.venue.updateMany({ data: { isActive: false } }),
      prisma.venue.update({ where: { id: venue.id }, data: { isActive: true } }),
    ])
    revalider()
    redirect(
      urlListe('ok', `« ${venue.name} » activée — ${result.seats} places, ${result.rows} rangées.`),
    )
  } catch (error) {
    // redirect() fonctionne en levant une exception : on la laisse passer.
    if (error && typeof error === 'object' && 'digest' in error) throw error
    redirect(urlListe('err', messageErreur(error)))
  }
}

// Revient à la salle « par défaut » (VENUE_ID ou intégrée) : re-synchronise
// le plan depuis cette config puis efface les drapeaux.
export async function desactiverSalleAction(): Promise<void> {
  await requireAdmin()
  try {
    const result = await syncPlan(prisma, loadVenueConfig())
    await prisma.venue.updateMany({ data: { isActive: false } })
    revalider()
    redirect(urlListe('ok', `Salle par défaut restaurée — ${result.seats} places.`))
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error
    redirect(urlListe('err', messageErreur(error)))
  }
}

export async function supprimerSalleAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  if (!id.success) redirect(urlListe('err', 'Identifiant invalide.'))

  const venue = await prisma.venue.findUnique({ where: { id: id.data } })
  if (!venue) redirect(urlListe('err', 'Salle introuvable.'))
  if (venue.isActive) {
    redirect(urlListe('err', 'Impossible de supprimer la salle active — désactivez-la d’abord.'))
  }

  await prisma.venue.delete({ where: { id: venue.id } })
  revalidatePath('/admin/salles')
  redirect(urlListe('ok', `« ${venue.name} » supprimée.`))
}
