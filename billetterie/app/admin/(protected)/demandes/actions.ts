'use server'

// Server actions de la liste des demandes. Chaque action : requireAdmin
// (défense en profondeur après proxy.ts) + zod sur l'id + try/catch →
// message affichable via ?ok=… / ?err=… + revalidatePath.
//
// `retour` = filtres courants de la liste (rep/statut/q), re-sérialisés en
// liste blanche — jamais réinjectés tels quels dans le redirect.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  annulerDemande,
  changerNombrePlaces,
  chargerBookingAvecBillets,
  marquerPayee,
  prolongerExpiration,
  type BookingAvecBillets,
} from '@/lib/admin/bookings'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)
const placesSchema = z.coerce.number().int().min(1).max(8)

// Module email créé en parallèle par un autre agent : import dynamique +
// fonctions optionnelles, pour que la liste fonctionne même si les exports
// n'existent pas encore. L'échec d'un email est toléré partout.
type EmailModule = {
  sendTicketsEmail?: (b: BookingAvecBillets) => Promise<boolean>
  sendCancelledEmail?: (b: {
    name: string
    email: string
    partySize: number
    representation: { title: string; startsAt: Date }
  }) => Promise<boolean>
}

async function chargerModuleEmail(): Promise<EmailModule> {
  try {
    return (await import('@/lib/email/booking')) as unknown as EmailModule
  } catch {
    return {}
  }
}

function messageErreur(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur est survenue.'
}

// Reconstruit l'URL de la liste avec les filtres (liste blanche) + message.
function urlListe(retour: unknown, cle: 'ok' | 'err', message: string): string {
  const filtres = new URLSearchParams(typeof retour === 'string' ? retour : '')
  const params = new URLSearchParams()
  for (const nom of ['rep', 'statut', 'q'] as const) {
    const valeur = filtres.get(nom)
    if (valeur) params.set(nom, valeur.slice(0, 100))
  }
  params.set(cle, message)
  return `/admin/demandes?${params.toString()}`
}

function lireId(formData: FormData): string {
  const parsed = idSchema.safeParse(formData.get('id'))
  if (!parsed.success) redirect(urlListe(formData.get('retour'), 'err', 'Identifiant invalide.'))
  return parsed.data
}

// pending → paid, puis direction l'écran de placement (écran d'un autre agent).
export async function marquerPayeeAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = lireId(formData)
  try {
    await marquerPayee(prisma, id)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  redirect(`/admin/placement/${id}`)
}

// Rectifier le nombre de places. Si la demande était placée, le placement est
// invalidé et on redirige vers l'écran de placement pour ré-attribuer.
export async function rectifierPlacesAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = lireId(formData)
  const parsed = placesSchema.safeParse(formData.get('places'))
  if (!parsed.success) {
    redirect(urlListe(formData.get('retour'), 'err', 'Nombre de places invalide (1 à 8).'))
  }

  let res: Awaited<ReturnType<typeof changerNombrePlaces>>
  try {
    res = await changerNombrePlaces(prisma, id, parsed.data)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }

  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  if (res.etaitPlace) {
    // Le placement n'est plus valide : on ré-attribue les sièges.
    redirect(`/admin/placement/${id}`)
  }
  redirect(urlListe(formData.get('retour'), 'ok', 'Nombre de places mis à jour.'))
}

export async function prolongerAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = lireId(formData)
  try {
    await prolongerExpiration(prisma, id)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  redirect(urlListe(formData.get('retour'), 'ok', 'Échéance prolongée de 14 jours.'))
}

export async function annulerAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = lireId(formData)

  let infos: Awaited<ReturnType<typeof annulerDemande>>
  try {
    infos = await annulerDemande(prisma, id)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }

  // Email d'annulation : best effort, son échec n'annule pas l'annulation.
  try {
    const emails = await chargerModuleEmail()
    await emails.sendCancelledEmail?.(infos)
  } catch {
    // Ignoré volontairement.
  }

  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  // Pas de nom dans l'URL : elle finit dans les access logs (NPM/Cloudflare).
  redirect(urlListe(formData.get('retour'), 'ok', 'Demande annulée.'))
}

export async function renvoyerBilletsAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = lireId(formData)

  let booking: BookingAvecBillets
  try {
    const statut = await prisma.booking.findUnique({ where: { id }, select: { status: true } })
    if (!statut) throw new Error('Demande introuvable.')
    if (statut.status !== 'placed') {
      throw new Error('Seule une demande placée a des billets à renvoyer.')
    }
    booking = await chargerBookingAvecBillets(prisma, id)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }

  let envoye = false
  try {
    const emails = await chargerModuleEmail()
    if (!emails.sendTicketsEmail) {
      redirect(urlListe(formData.get('retour'), 'err', "L'envoi d'emails n'est pas encore disponible."))
    }
    envoye = await emails.sendTicketsEmail(booking)
  } catch (error) {
    // redirect() fonctionne en levant une exception : on la laisse passer.
    if (error && typeof error === 'object' && 'digest' in error) throw error
    envoye = false
  }

  redirect(
    envoye
      ? urlListe(formData.get('retour'), 'ok', `Billets renvoyés à ${booking.email}.`)
      : urlListe(formData.get('retour'), 'err', "L'email n'a pas pu être envoyé, réessaie plus tard."),
  )
}
