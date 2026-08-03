'use server'

// Gestion des représentations : créer, modifier, ouvrir/fermer les
// réservations, archiver/désarchiver, supprimer. Même pattern que les actions
// des demandes : requireAdmin + zod + try/catch → message via ?ok=/?err= +
// revalidatePath.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { euros } from '@/lib/admin/money'
import { setTicketPrices } from '@/lib/admin/pricing'
import { requireSuperAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { parisToUtc } from '@/lib/paris-time'

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)

// Refus commun aux actions qui touchent une représentation archivée (elle est
// figée tant qu'on ne l'a pas désarchivée).
const MESSAGE_REP_ARCHIVEE =
  'Représentation archivée : désarchive-la d’abord pour la modifier.'

// Prix en euros (« 12 », « 12,50 ») → centimes ; borné à 1000 €.
const prixSchema = z
  .string()
  .trim()
  .max(10)
  .transform((v) => Number(v.replace(',', '.')))
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 1000)
  .transform((e) => Math.round(e * 100))

// Un champ de prix : vide → null (effacer ce tarif) ; sinon centimes, ou
// 'invalide' si le format est mauvais.
function lirePrix(brut: FormDataEntryValue | null): number | null | 'invalide' {
  if (typeof brut !== 'string' || brut.trim() === '') return null
  const parsed = prixSchema.safeParse(brut)
  return parsed.success ? parsed.data : 'invalide'
}

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
  // Archiver retire aussi la représentation des sélecteurs plan / scan.
  revalidatePath('/admin/plan')
  revalidatePath('/admin/scan')
  revalidatePath('/') // le formulaire public liste les représentations ouvertes
}

// Fixe (ou efface) les tarifs globaux adulte / enfant. Chaque champ vide =
// effacer ce tarif (montant dû correspondant désactivé).
export async function definirPrixAction(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const adulte = lirePrix(formData.get('prixAdulte'))
  const enfant = lirePrix(formData.get('prixEnfant'))
  if (adulte === 'invalide' || enfant === 'invalide') {
    versListe('err', 'Prix invalide (montant en euros, entre 0 et 1000).')
  }
  await setTicketPrices(prisma, { adultCents: adulte, childCents: enfant })
  rafraichir()
  const parts = [
    adulte != null ? `adulte ${euros(adulte)}` : null,
    enfant != null ? `enfant ${euros(enfant)}` : null,
  ].filter(Boolean)
  versListe('ok', parts.length ? `Tarifs : ${parts.join(', ')}.` : 'Tarifs effacés (montant dû désactivé).')
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

  const existante = await prisma.representation.findUnique({ where: { id: id.data } })
  if (!existante) versListe('err', 'Représentation introuvable.')
  // Une rep archivée est figée, titre et date compris (cohérent avec le gel de
  // ses demandes) : on la désarchive d'abord.
  if (existante.archivedAt) versListe('err', MESSAGE_REP_ARCHIVEE)

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
  // Garde-fou : une rep archivée ne peut pas rouvrir ses ventes sans passer par
  // le désarchivage explicite (sinon elle réapparaîtrait côté public).
  if (rep.archivedAt) versListe('err', MESSAGE_REP_ARCHIVEE)

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

// Archiver = clôturer la représentation : ses demandes sortent du quotidien et
// sont gelées, mais RIEN n'est supprimé ni muté (stats, historique et export
// CSV continuent de la servir). Réversible — cf. lib/admin/archive.ts.
export async function archiverRepresentation(formData: FormData): Promise<void> {
  const { email } = await requireSuperAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  if (!id.success) versListe('err', 'Représentation introuvable.')

  const rep = await prisma.representation.findUnique({ where: { id: id.data } })
  if (!rep) versListe('err', 'Représentation introuvable.')
  if (rep.archivedAt) versListe('err', `« ${rep.title} » est déjà archivée.`)

  // Archiver FERME les réservations dans la même écriture : une représentation
  // archivée ne peut pas rester proposée sur le formulaire public.
  await prisma.representation.update({
    where: { id: rep.id },
    data: { archivedAt: new Date(), archivedBy: email, isOpen: false },
  })
  rafraichir()
  versListe(
    'ok',
    `« ${rep.title} » archivée : ses demandes sortent des écrans du quotidien et sont gelées (rien n’est supprimé).`,
  )
}

// Désarchiver ne ROUVRE PAS les ventes : la représentation revient simplement
// « fermée ». Sinon un clic la republierait sur le formulaire public.
export async function desarchiverRepresentation(formData: FormData): Promise<void> {
  await requireSuperAdmin()
  const id = idSchema.safeParse(formData.get('id'))
  if (!id.success) versListe('err', 'Représentation introuvable.')

  const rep = await prisma.representation.findUnique({ where: { id: id.data } })
  if (!rep) versListe('err', 'Représentation introuvable.')
  if (!rep.archivedAt) versListe('err', `« ${rep.title} » n’est pas archivée.`)

  await prisma.representation.update({
    where: { id: rep.id },
    data: { archivedAt: null, archivedBy: null },
  })
  rafraichir()
  versListe(
    'ok',
    `« ${rep.title} » désarchivée — réservations fermées, ouvre-les si tu reprends les ventes.`,
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
      `Suppression impossible : ${bookings} demande(s) liée(s). Archive plutôt la représentation — elle sort du quotidien sans rien perdre.`,
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
