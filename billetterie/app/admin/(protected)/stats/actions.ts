'use server'

// Server actions du « bilan d'organisation » (page /admin/stats) : météo +
// notes libres de la représentation, et articles de buvette (proposé / vendu /
// prix). Saisie 100 % manuelle, pour capitaliser d'une année sur l'autre.
// requireAdmin + zod sur chaque entrée, comme les autres actions admin.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)
const labelSchema = z.string().trim().min(1).max(60)
const qtySchema = z.coerce.number().int().min(0).max(100_000)
// Prix en euros saisi par le bénévole ("3", "2,5") → centimes.
const prixCentsSchema = z
  .string()
  .trim()
  .transform((v) => Number(v.replace(',', '.')))
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 1000)
  .transform((euros) => Math.round(euros * 100))

function lireRepId(formData: FormData): string {
  const parsed = idSchema.safeParse(formData.get('repId'))
  if (!parsed.success) redirect('/admin/stats')
  return parsed.data
}

// Revalide et renvoie sur la section de la bonne représentation (ancre).
function retour(repId: string): never {
  revalidatePath('/admin/stats')
  redirect(`/admin/stats#rep-${repId}`)
}

function lireQty(formData: FormData, champ: string): number {
  const parsed = qtySchema.safeParse(formData.get(champ) ?? '0')
  return parsed.success ? parsed.data : 0
}

function lirePrixCents(formData: FormData): number {
  const parsed = prixCentsSchema.safeParse(formData.get('prix') ?? '0')
  return parsed.success ? parsed.data : 0
}

// Météo + notes libres de la représentation.
export async function enregistrerBilanAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const repId = lireRepId(formData)
  const weather = z.string().trim().max(200).safeParse(formData.get('weather') ?? '')
  const orgNotes = z.string().trim().max(2000).safeParse(formData.get('orgNotes') ?? '')
  await prisma.representation.update({
    where: { id: repId },
    data: {
      weather: weather.success && weather.data ? weather.data : null,
      orgNotes: orgNotes.success && orgNotes.data ? orgNotes.data : null,
    },
  })
  retour(repId)
}

// Ajoute un article de buvette.
export async function ajouterBuvetteAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const repId = lireRepId(formData)
  const label = labelSchema.safeParse(formData.get('label'))
  if (!label.success) retour(repId) // article vide : on ignore
  await prisma.buvetteItem.create({
    data: {
      representationId: repId,
      label: label.data,
      qtyStock: lireQty(formData, 'qtyStock'),
      qtySold: lireQty(formData, 'qtySold'),
      unitPriceCents: lirePrixCents(formData),
    },
  })
  retour(repId)
}

// Modifie un article existant (scopé à la représentation, défensif).
export async function modifierBuvetteAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const repId = lireRepId(formData)
  const id = idSchema.safeParse(formData.get('id'))
  const label = labelSchema.safeParse(formData.get('label'))
  if (!id.success || !label.success) retour(repId)
  await prisma.buvetteItem.updateMany({
    where: { id: id.data, representationId: repId },
    data: {
      label: label.data,
      qtyStock: lireQty(formData, 'qtyStock'),
      qtySold: lireQty(formData, 'qtySold'),
      unitPriceCents: lirePrixCents(formData),
    },
  })
  retour(repId)
}

// Supprime un article.
export async function supprimerBuvetteAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const repId = lireRepId(formData)
  const id = idSchema.safeParse(formData.get('id'))
  if (id.success) {
    await prisma.buvetteItem.deleteMany({ where: { id: id.data, representationId: repId } })
  }
  retour(repId)
}
