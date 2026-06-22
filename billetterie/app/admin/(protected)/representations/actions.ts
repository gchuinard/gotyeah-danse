'use server'

// Gestion des représentations : créer, modifier, ouvrir/fermer les
// réservations, supprimer. Même pattern que les actions des demandes :
// requireAdmin + zod + try/catch → message via ?ok=/?err= + revalidatePath.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { euros } from '@/lib/admin/money'
import { clearTicketPrice, setTicketPriceCents } from '@/lib/admin/pricing'
import { requireSuperAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { parisToUtc } from '@/lib/paris-time'

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)

// Prix unitaire en euros (« 12 », « 12,50 ») → centimes ; borné à 1000 €.
const prixSchema = z
  .string()
  .trim()
  .max(10)
  .transform((v) => Number(v.replace(',', '.')))
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 1000)
  .transform((e) => Math.round(e * 100))

const formSchema = z.object({
  title: z.string().trim().min(2, 'Titre trop court').max(100),
  // Valeur d'un <input type="datetime-local">, interprétée en heure de Paris.
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Date invalide'),
})

function versListe(type: 'ok' | 'err', message: string): never {
  const params = new URLSearchParams({ [type]: message })
  redirect(`/admin/representations?${params}`)
}

function rafraichir() {
  revalidatePath('/admin/representations')
  revalidatePath('/admin')
  revalidatePath('/admin/demandes') // le prix change les montants dus affichés
  revalidatePath('/admin/stats')
  revalidatePath('/') // le formulaire public liste les représentations ouvertes
}

// Fixe (ou efface) le prix unitaire global d'une place. Champ vide = effacer.
export async function definirPrixAction(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const brut = formData.get('prix')
  if (typeof brut === 'string' && brut.trim() === '') {
    await clearTicketPrice(prisma)
    rafraichir()
    versListe('ok', 'Prix unitaire effacé (montant dû désactivé).')
  }
  const parsed = prixSchema.safeParse(brut)
  if (!parsed.success) versListe('err', 'Prix invalide (montant en euros, entre 0 et 1000).')
  await setTicketPriceCents(prisma, parsed.data)
  rafraichir()
  versListe('ok', `Prix unitaire fixé à ${euros(parsed.data)}.`)
}

export async function creerRepresentation(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const parsed = formSchema.safeParse({
    title: formData.get('title'),
    startsAt: formData.get('startsAt'),
  })
  if (!parsed.success) versListe('err', parsed.error.issues[0].message)

  await prisma.representation.create({
    data: {
      title: parsed.data.title,
      startsAt: parisToUtc(parsed.data.startsAt),
      isOpen: false, // fermée à la création : on ouvre explicitement
    },
  })
  rafraichir()
  versListe('ok', 'Représentation créée (réservations fermées — ouvre-les quand tout est prêt).')
}

export async function modifierRepresentation(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  const parsed = formSchema.safeParse({
    title: formData.get('title'),
    startsAt: formData.get('startsAt'),
  })
  if (!id.success) versListe('err', 'Représentation introuvable.')
  if (!parsed.success) versListe('err', parsed.error.issues[0].message)

  try {
    await prisma.representation.update({
      where: { id: id.data },
      data: { title: parsed.data.title, startsAt: parisToUtc(parsed.data.startsAt) },
    })
  } catch {
    versListe('err', 'Représentation introuvable.')
  }
  rafraichir()
  versListe('ok', 'Représentation modifiée.')
}

export async function basculerOuverture(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  if (!id.success) versListe('err', 'Représentation introuvable.')

  const rep = await prisma.representation.findUnique({ where: { id: id.data } })
  if (!rep) versListe('err', 'Représentation introuvable.')

  await prisma.representation.update({
    where: { id: rep.id },
    data: { isOpen: !rep.isOpen },
  })
  rafraichir()
  versListe(
    'ok',
    rep.isOpen
      ? `Réservations fermées pour « ${rep.title} ».`
      : `Réservations ouvertes pour « ${rep.title} ».`,
  )
}

export async function supprimerRepresentation(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  if (!id.success) versListe('err', 'Représentation introuvable.')

  // On ne supprime JAMAIS une représentation qui a des demandes (même
  // annulées ou expirées : c'est de l'historique). Les blocages de sièges,
  // eux, sont de la configuration : purgés avec.
  const bookings = await prisma.booking.count({ where: { representationId: id.data } })
  if (bookings > 0) {
    versListe(
      'err',
      `Suppression impossible : ${bookings} demande(s) liée(s). Ferme plutôt les réservations.`,
    )
  }

  try {
    await prisma.$transaction([
      prisma.seatOverride.deleteMany({ where: { representationId: id.data } }),
      prisma.representation.delete({ where: { id: id.data } }),
    ])
  } catch {
    versListe('err', 'Suppression impossible (représentation introuvable ou demandes liées).')
  }
  rafraichir()
  versListe('ok', 'Représentation supprimée.')
}
