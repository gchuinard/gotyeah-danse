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
  ajouterPaiement,
  annulerDemande,
  annulerPaiement,
  changerNombrePlaces,
  chargerBookingAvecBillets,
  definirPlacesOffertes,
  enregistrerRemboursement,
  prolongerExpiration,
  supprimerPaiement,
  type BookingAvecBillets,
} from '@/lib/admin/bookings'
import { logBookingEvent } from '@/lib/admin/events'
import { euros } from '@/lib/admin/money'
import { getTicketPriceCents } from '@/lib/admin/pricing'
import { MOTIF_AUTRE } from '@/lib/admin/refund-motifs'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { MAX_PARTY_SIZE } from '@/lib/public/limits'

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)
const placesSchema = z.coerce.number().int().min(1).max(MAX_PARTY_SIZE)
const methodeSchema = z.enum(['especes', 'cheque', 'autre'])
// Montant en euros saisi par le bénévole ("25", "25,50") → centimes.
const montantSchema = z
  .string()
  .trim()
  .max(10)
  .transform((v) => Number(v.replace(',', '.')))
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 10_000)
  .transform((euros) => Math.round(euros * 100))
const annotationSchema = z.string().trim().max(300)
const raisonSchema = z.string().trim().max(200)
const referenceSchema = z.string().trim().max(60)
// Date de dépôt d'un chèque : valeur d'un <input type="date"> (AAAA-MM-JJ).
const depositSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const freeSeatsSchema = z.coerce.number().int().min(0).max(MAX_PARTY_SIZE)

// Date « jour » (sans heure) en français, fuseau Paris — pour l'historique.
const dateJourFr = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const METHODE_MOT: Record<string, string> = {
  especes: 'espèces',
  cheque: 'chèque',
  autre: 'autre',
}

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

// Enregistre UN versement (espèces / chèque, éventuellement échelonné). Méthode
// + montant requis ; date de dépôt et référence facultatives (chèques). Cas
// courant — une demande en attente réglée d'un coup → on enchaîne le placement.
export async function ajouterPaiementAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
  const id = lireId(formData)

  const methode = methodeSchema.safeParse(formData.get('methode'))
  if (!methode.success) {
    redirect(urlListe(formData.get('retour'), 'err', 'Mode de règlement invalide.'))
  }
  const montant = montantSchema.safeParse(formData.get('montant'))
  if (!montant.success || montant.data <= 0) {
    redirect(urlListe(formData.get('retour'), 'err', 'Montant invalide (renseignez un montant supérieur à 0).'))
  }

  // Date de dépôt (chèque échelonné) : facultative. Stockée à midi UTC pour
  // éviter tout décalage de jour à l'affichage (formaté ensuite en heure Paris).
  const depBrut = formData.get('depositOn')
  let depositOn: Date | null = null
  if (typeof depBrut === 'string' && depBrut.trim() !== '') {
    const d = depositSchema.safeParse(depBrut.trim())
    if (!d.success) {
      redirect(urlListe(formData.get('retour'), 'err', 'Date de dépôt invalide.'))
    }
    const dt = new Date(`${d.data}T12:00:00.000Z`)
    // Round-trip : rejette les dates impossibles (« 2026-06-31 » roulerait au
    // 01/07, « 2026-99-99 » donnerait Invalid Date) que la regex laisse passer.
    if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d.data) {
      redirect(urlListe(formData.get('retour'), 'err', 'Date de dépôt invalide.'))
    }
    depositOn = dt
  }
  const reference = referenceSchema.safeParse(formData.get('reference') ?? '')

  const unitPrice = await getTicketPriceCents(prisma)

  let res: Awaited<ReturnType<typeof ajouterPaiement>>
  try {
    res = await ajouterPaiement(
      prisma,
      id,
      {
        method: methode.data,
        amountCents: montant.data,
        depositOn,
        reference: reference.success ? reference.data : null,
      },
      unitPrice,
    )
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }

  const detail =
    [
      METHODE_MOT[methode.data],
      euros(montant.data),
      depositOn ? `dépôt ${dateJourFr.format(depositOn)}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || null
  await logBookingEvent(id, 'payment_added', email, detail)
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  // Cas courant : une demande en attente réglée intégralement en une fois → on
  // enchaîne sur l'écran de placement (préserve l'ancien flux « marquer payée »).
  // Acompte ou demande déjà « à placer »/placée → on reste sur la liste.
  if (res.etaitPending && res.nowSoldee && !res.etaitPlace) {
    redirect(`/admin/placement/${id}`)
  }
  redirect(
    urlListe(
      formData.get('retour'),
      'ok',
      res.nowSoldee ? 'Versement enregistré (demande soldée).' : 'Versement enregistré (acompte).',
    ),
  )
}

// Supprime un versement saisi par erreur (cf. lib/admin/bookings.supprimerPaiement).
export async function supprimerPaiementAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
  const id = lireId(formData)
  const pid = idSchema.safeParse(formData.get('paymentId'))
  if (!pid.success) {
    redirect(urlListe(formData.get('retour'), 'err', 'Versement introuvable.'))
  }
  try {
    await supprimerPaiement(prisma, id, pid.data)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }
  await logBookingEvent(id, 'payment_removed', email)
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  redirect(urlListe(formData.get('retour'), 'ok', 'Versement supprimé.'))
}

// Définit le nombre de places offertes (exclues du montant dû).
export async function definirPlacesOffertesAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
  const id = lireId(formData)
  const parsed = freeSeatsSchema.safeParse(formData.get('freeSeats'))
  if (!parsed.success) {
    redirect(urlListe(formData.get('retour'), 'err', 'Nombre de places offertes invalide.'))
  }
  try {
    await definirPlacesOffertes(prisma, id, parsed.data)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }
  await logBookingEvent(id, 'free_seats', email, `${parsed.data} place(s) offerte(s)`)
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  redirect(urlListe(formData.get('retour'), 'ok', 'Places offertes mises à jour.'))
}

// Annule un règlement posé par erreur (cf. lib/admin/bookings.annulerPaiement).
// « À placer » → repasse en attente ; déjà placée → garde ses sièges (non réglée).
export async function annulerPaiementAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
  const id = lireId(formData)
  let res: Awaited<ReturnType<typeof annulerPaiement>>
  try {
    res = await annulerPaiement(prisma, id)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }
  await logBookingEvent(id, 'unpaid', email)
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  redirect(
    urlListe(
      formData.get('retour'),
      'ok',
      res.statut === 'placed'
        ? 'Règlement annulé (la demande reste placée, non réglée).'
        : 'Règlement annulé (demande repassée en attente).',
    ),
  )
}

// Annotation interne (n° de chèque, contexte famille…) — visible uniquement
// dans le back-office, jamais côté famille. Chaîne vide = effacer.
export async function annoterAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
  const id = lireId(formData)
  const parsed = annotationSchema.safeParse(formData.get('annotation'))
  if (!parsed.success) {
    redirect(urlListe(formData.get('retour'), 'err', 'Annotation invalide (300 caractères max).'))
  }
  try {
    await prisma.booking.update({
      where: { id },
      data: { adminNotes: parsed.data === '' ? null : parsed.data },
    })
  } catch {
    redirect(urlListe(formData.get('retour'), 'err', 'Demande introuvable.'))
  }
  await logBookingEvent(id, 'note', email, parsed.data === '' ? 'effacée' : null)
  revalidatePath('/admin/demandes')
  redirect(urlListe(formData.get('retour'), 'ok', 'Annotation enregistrée.'))
}

// Rectifier le nombre de places. Si la demande était placée, le placement est
// invalidé et on redirige vers l'écran de placement pour ré-attribuer.
export async function rectifierPlacesAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
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

  // Une ligne d'historique par changement réel : « ancien → nouveau places »
  // (permet de suivre p.ex. 5 → 3 → 5 au fil des allers-retours).
  if (res.ancienNombre !== parsed.data) {
    await logBookingEvent(
      id,
      'party_changed',
      email,
      `${res.ancienNombre} → ${parsed.data} place${parsed.data > 1 ? 's' : ''}`,
    )
  }
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  if (res.etaitPlace) {
    // Le placement n'est plus valide : on ré-attribue les sièges. Les anciens
    // sièges sont transmis en rappel (couleur dédiée) pour les replacer au même
    // endroit si possible.
    const anciens = res.anciensSeatIds.join(',')
    redirect(`/admin/placement/${id}${anciens ? `?anciens=${anciens}` : ''}`)
  }
  redirect(urlListe(formData.get('retour'), 'ok', 'Nombre de places mis à jour.'))
}

// Enregistre un remboursement (montant + motif) sur une demande déjà réglée —
// ex. après le retrait de places. La caisse comptera le net (encaissé − remboursé).
export async function rembourserAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
  const id = lireId(formData)
  const montant = montantSchema.safeParse(formData.get('montant'))
  if (!montant.success) {
    redirect(urlListe(formData.get('retour'), 'err', 'Montant de remboursement invalide.'))
  }
  // Motif : valeur du menu déroulant, sauf « Autre… » → champ libre.
  const choix = String(formData.get('raison') ?? '')
  const raisonBrute = choix === MOTIF_AUTRE ? formData.get('raisonAutre') : choix
  const raison = raisonSchema.safeParse(raisonBrute ?? '')
  const motif = raison.success && raison.data ? raison.data : undefined

  try {
    await enregistrerRemboursement(prisma, id, { refundCents: montant.data, refundReason: motif })
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }

  const montantTxt = `${(montant.data / 100).toFixed(2).replace('.', ',')} €`
  await logBookingEvent(id, 'refunded', email, motif ? `${montantTxt} · ${motif}` : montantTxt)
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  redirect(urlListe(formData.get('retour'), 'ok', 'Remboursement enregistré.'))
}

export async function prolongerAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
  const id = lireId(formData)
  try {
    await prolongerExpiration(prisma, id)
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }
  await logBookingEvent(id, 'extended', email)
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  redirect(urlListe(formData.get('retour'), 'ok', 'Échéance prolongée de 14 jours.'))
}

export async function annulerAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
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

  await logBookingEvent(id, 'cancelled', email)
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  // Pas de nom dans l'URL : elle finit dans les access logs (NPM/Cloudflare).
  redirect(urlListe(formData.get('retour'), 'ok', 'Demande annulée.'))
}

export async function renvoyerBilletsAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
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

  if (envoye) await logBookingEvent(id, 'tickets_sent', email)
  redirect(
    envoye
      ? urlListe(formData.get('retour'), 'ok', `Billets renvoyés à ${booking.email}.`)
      : urlListe(formData.get('retour'), 'err', "L'email n'a pas pu être envoyé, réessaie plus tard."),
  )
}

// Bascule la remise des billets entre e-billet (email + QR) et papier (l'admin
// imprime, aucun envoi auto). Choix purement admin, modifiable à tout moment.
export async function basculerRemiseAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin()
  const id = lireId(formData)
  let nouveauMode: 'email' | 'papier' = 'email'
  try {
    const b = await prisma.booking.findUnique({ where: { id }, select: { ticketMode: true } })
    if (!b) throw new Error('Demande introuvable.')
    nouveauMode = b.ticketMode === 'papier' ? 'email' : 'papier'
    await prisma.booking.update({ where: { id }, data: { ticketMode: nouveauMode } })
  } catch (error) {
    redirect(urlListe(formData.get('retour'), 'err', messageErreur(error)))
  }
  await logBookingEvent(id, 'ticket_mode', email, `→ ${nouveauMode === 'papier' ? 'papier' : 'e-billet'}`)
  revalidatePath('/admin/demandes')
  redirect(
    urlListe(
      formData.get('retour'),
      'ok',
      nouveauMode === 'papier' ? 'Remise en papier (à imprimer).' : 'Remise en e-billet (par email).',
    ),
  )
}
