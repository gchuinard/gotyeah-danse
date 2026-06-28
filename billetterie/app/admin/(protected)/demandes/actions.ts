'use server'

// Server actions de la popup « centre d'actions » des demandes. Chaque action :
// requireAdmin (défense en profondeur après proxy.ts) + zod sur l'id + try/catch
// → renvoie un ActionState { ok? | error? } (pas de redirect) pour que la POPUP
// RESTE OUVERTE : le résultat s'affiche inline, et revalidatePath rafraîchit la
// liste / le dashboard / la caisse sans navigation. Seule exception :
// rectifierPlacesAction redirige vers l'écran de placement quand une demande
// DÉJÀ PLACÉE change de nombre de places (re-placement obligatoire).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  ajouterPaiement,
  annulerDemande,
  annulerPaiement,
  changerNombrePlaces,
  chargerBookingAvecBillets,
  definirNombreEnfants,
  definirPlacesOffertes,
  enregistrerRemboursement,
  prolongerExpiration,
  supprimerPaiement,
  type BookingAvecBillets,
} from '@/lib/admin/bookings'
import { logBookingEvent } from '@/lib/admin/events'
import { euros } from '@/lib/admin/money'
import { getTicketPrices } from '@/lib/admin/pricing'
import {
  MOTIF_AUTRE,
  MOTIF_PLACES_RETIREES,
  MOTIF_PLACES_RETIREES_SEP,
} from '@/lib/admin/refund-motifs'
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
const childCountSchema = z.coerce.number().int().min(0).max(MAX_PARTY_SIZE)
const placesRetireesSchema = z.coerce.number().int().min(1).max(MAX_PARTY_SIZE)

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

// État renvoyé à la popup (useActionState) : message inline, la popup reste
// ouverte. Toutes les actions ci-dessous partagent ce contrat.
export type ActionState = { ok?: string; error?: string }

function messageErreur(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur est survenue.'
}

// id de la demande, ou un ActionState d'erreur prêt à renvoyer.
function lireId(formData: FormData): { id: string } | ActionState {
  const parsed = idSchema.safeParse(formData.get('id'))
  return parsed.success ? { id: parsed.data } : { error: 'Identifiant invalide.' }
}

// Rafraîchit les vues impactées par une action (sans navigation).
function rafraichir() {
  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  revalidatePath('/admin/stats')
}

// Enregistre UN versement (espèces / chèque, éventuellement échelonné). Méthode
// + montant requis ; date de dépôt et référence facultatives (chèques). La popup
// reste ouverte → on enchaîne plusieurs chèques sans rouvrir la demande.
export async function ajouterPaiementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id

  const methode = methodeSchema.safeParse(formData.get('methode'))
  if (!methode.success) return { error: 'Mode de règlement invalide.' }
  const montant = montantSchema.safeParse(formData.get('montant'))
  if (!montant.success || montant.data <= 0) {
    return { error: 'Montant invalide (renseignez un montant supérieur à 0).' }
  }

  // Date de dépôt (chèque échelonné) : facultative. Stockée à midi UTC pour
  // éviter tout décalage de jour à l'affichage (formaté ensuite en heure Paris).
  const depBrut = formData.get('depositOn')
  let depositOn: Date | null = null
  if (typeof depBrut === 'string' && depBrut.trim() !== '') {
    const d = depositSchema.safeParse(depBrut.trim())
    if (!d.success) return { error: 'Date de dépôt invalide.' }
    const dt = new Date(`${d.data}T12:00:00.000Z`)
    // Round-trip : rejette les dates impossibles (« 2026-06-31 » roulerait au
    // 01/07, « 2026-99-99 » donnerait Invalid Date) que la regex laisse passer.
    if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d.data) {
      return { error: 'Date de dépôt invalide.' }
    }
    depositOn = dt
  }
  const reference = referenceSchema.safeParse(formData.get('reference') ?? '')

  const prices = await getTicketPrices(prisma)

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
      prices,
    )
  } catch (error) {
    return { error: messageErreur(error) }
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
  rafraichir()
  return {
    ok: res.nowSoldee
      ? 'Versement enregistré — demande soldée. Vous pouvez la placer.'
      : 'Versement enregistré (acompte).',
  }
}

// Supprime un versement saisi par erreur (cf. lib/admin/bookings.supprimerPaiement).
export async function supprimerPaiementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  const pid = idSchema.safeParse(formData.get('paymentId'))
  if (!pid.success) return { error: 'Versement introuvable.' }
  try {
    await supprimerPaiement(prisma, id, pid.data)
  } catch (error) {
    return { error: messageErreur(error) }
  }
  await logBookingEvent(id, 'payment_removed', email)
  rafraichir()
  return { ok: 'Versement supprimé.' }
}

// Définit le nombre de places offertes (exclues du montant dû).
export async function definirPlacesOffertesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  const parsed = freeSeatsSchema.safeParse(formData.get('freeSeats'))
  if (!parsed.success) return { error: 'Nombre de places offertes invalide.' }
  try {
    await definirPlacesOffertes(prisma, id, parsed.data)
  } catch (error) {
    return { error: messageErreur(error) }
  }
  await logBookingEvent(id, 'free_seats', email, `${parsed.data} place(s) offerte(s)`)
  rafraichir()
  return { ok: 'Places offertes mises à jour.' }
}

// Définit le nombre d'enfants (parmi partySize) → répartition du montant dû.
export async function definirNombreEnfantsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  const parsed = childCountSchema.safeParse(formData.get('childCount'))
  if (!parsed.success) return { error: "Nombre d'enfants invalide." }
  let res: Awaited<ReturnType<typeof definirNombreEnfants>>
  try {
    res = await definirNombreEnfants(prisma, id, parsed.data)
  } catch (error) {
    return { error: messageErreur(error) }
  }
  await logBookingEvent(
    id,
    'child_count',
    email,
    `${res.childCount} enfant(s) / ${res.adultes} adulte(s)`,
  )
  rafraichir()
  return { ok: 'Répartition adultes / enfants mise à jour.' }
}

// Annule TOUT le règlement (cf. lib/admin/bookings.annulerPaiement). « À placer »
// → repasse en attente ; déjà placée → garde ses sièges (non réglée).
export async function annulerPaiementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  let res: Awaited<ReturnType<typeof annulerPaiement>>
  try {
    res = await annulerPaiement(prisma, id)
  } catch (error) {
    return { error: messageErreur(error) }
  }
  await logBookingEvent(id, 'unpaid', email)
  rafraichir()
  return {
    ok:
      res.statut === 'placed'
        ? 'Règlement annulé (la demande reste placée, non réglée).'
        : 'Règlement annulé (demande repassée en attente).',
  }
}

// Annotation interne (n° de chèque, contexte famille…) — visible uniquement
// dans le back-office, jamais côté famille. Chaîne vide = effacer.
export async function annoterAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  const parsed = annotationSchema.safeParse(formData.get('annotation'))
  if (!parsed.success) return { error: 'Annotation invalide (300 caractères max).' }
  try {
    await prisma.booking.update({
      where: { id },
      data: { adminNotes: parsed.data === '' ? null : parsed.data },
    })
  } catch {
    return { error: 'Demande introuvable.' }
  }
  await logBookingEvent(id, 'note', email, parsed.data === '' ? 'effacée' : null)
  rafraichir()
  return { ok: 'Annotation enregistrée.' }
}

// Rectifier le nombre de places. Si la demande était placée, le placement est
// invalidé → on REDIRIGE vers l'écran de placement pour ré-attribuer (seul cas
// où la popup se ferme : un re-placement est obligatoire). Sinon, popup ouverte.
export async function rectifierPlacesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  const parsed = placesSchema.safeParse(formData.get('places'))
  if (!parsed.success) return { error: 'Nombre de places invalide (1 à 8).' }

  let res: Awaited<ReturnType<typeof changerNombrePlaces>>
  try {
    res = await changerNombrePlaces(prisma, id, parsed.data)
  } catch (error) {
    return { error: messageErreur(error) }
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
  rafraichir()
  if (res.etaitPlace) {
    // Le placement n'est plus valide : on ré-attribue les sièges. Les anciens
    // sièges sont transmis en rappel (couleur dédiée) pour les replacer au même
    // endroit si possible.
    const anciens = res.anciensSeatIds.join(',')
    redirect(`/admin/placement/${id}${anciens ? `?anciens=${anciens}` : ''}`)
  }
  return { ok: 'Nombre de places mis à jour.' }
}

// Enregistre un remboursement (montant + motif) sur une demande déjà réglée —
// ex. après le retrait de places. La caisse comptera le net (reçu − remboursé).
export async function rembourserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  const montant = montantSchema.safeParse(formData.get('montant'))
  if (!montant.success) return { error: 'Montant de remboursement invalide.' }
  // Motif : valeur du menu déroulant. « Autre… » → champ libre ; « Place(s)
  // retirée(s) » → on y joint le nombre de places (« Place(s) retirée(s) : N »).
  const choix = String(formData.get('raison') ?? '')
  let motif: string | undefined
  if (choix === MOTIF_AUTRE) {
    const raison = raisonSchema.safeParse(formData.get('raisonAutre') ?? '')
    motif = raison.success && raison.data ? raison.data : undefined
  } else if (choix === MOTIF_PLACES_RETIREES) {
    const n = placesRetireesSchema.safeParse(formData.get('placesRetirees'))
    motif = n.success
      ? `${MOTIF_PLACES_RETIREES}${MOTIF_PLACES_RETIREES_SEP}${n.data}`
      : MOTIF_PLACES_RETIREES
  } else {
    const raison = raisonSchema.safeParse(choix)
    motif = raison.success && raison.data ? raison.data : undefined
  }

  try {
    await enregistrerRemboursement(prisma, id, { refundCents: montant.data, refundReason: motif })
  } catch (error) {
    return { error: messageErreur(error) }
  }

  const montantTxt = euros(montant.data)
  await logBookingEvent(id, 'refunded', email, motif ? `${montantTxt} · ${motif}` : montantTxt)
  rafraichir()
  return { ok: 'Remboursement enregistré.' }
}

export async function prolongerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  try {
    await prolongerExpiration(prisma, id)
  } catch (error) {
    return { error: messageErreur(error) }
  }
  await logBookingEvent(id, 'extended', email)
  rafraichir()
  return { ok: 'Échéance prolongée de 14 jours.' }
}

export async function annulerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id

  let infos: Awaited<ReturnType<typeof annulerDemande>>
  try {
    infos = await annulerDemande(prisma, id)
  } catch (error) {
    return { error: messageErreur(error) }
  }

  // Email d'annulation : best effort, son échec n'annule pas l'annulation.
  try {
    const emails = await chargerModuleEmail()
    await emails.sendCancelledEmail?.(infos)
  } catch {
    // Ignoré volontairement.
  }

  await logBookingEvent(id, 'cancelled', email)
  rafraichir()
  return { ok: 'Demande annulée.' }
}

export async function renvoyerBilletsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id

  let booking: BookingAvecBillets
  try {
    const statut = await prisma.booking.findUnique({ where: { id }, select: { status: true } })
    if (!statut) throw new Error('Demande introuvable.')
    if (statut.status !== 'placed') {
      throw new Error('Seule une demande placée a des billets à renvoyer.')
    }
    booking = await chargerBookingAvecBillets(prisma, id)
  } catch (error) {
    return { error: messageErreur(error) }
  }

  const emails = await chargerModuleEmail()
  if (!emails.sendTicketsEmail) {
    return { error: "L'envoi d'emails n'est pas encore disponible." }
  }
  let envoye = false
  try {
    envoye = await emails.sendTicketsEmail(booking)
  } catch {
    envoye = false
  }
  if (!envoye) return { error: "L'email n'a pas pu être envoyé, réessaie plus tard." }

  await logBookingEvent(id, 'tickets_sent', email)
  rafraichir()
  return { ok: `Billets renvoyés à ${booking.email}.` }
}

// Bascule la remise des billets entre e-billet (email + QR) et papier (l'admin
// imprime, aucun envoi auto). Choix purement admin, modifiable à tout moment.
export async function basculerRemiseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin()
  const r = lireId(formData)
  if (!('id' in r)) return r
  const id = r.id
  let nouveauMode: 'email' | 'papier' = 'email'
  try {
    const b = await prisma.booking.findUnique({ where: { id }, select: { ticketMode: true } })
    if (!b) throw new Error('Demande introuvable.')
    nouveauMode = b.ticketMode === 'papier' ? 'email' : 'papier'
    await prisma.booking.update({ where: { id }, data: { ticketMode: nouveauMode } })
  } catch (error) {
    return { error: messageErreur(error) }
  }
  await logBookingEvent(id, 'ticket_mode', email, `→ ${nouveauMode === 'papier' ? 'papier' : 'e-billet'}`)
  rafraichir()
  return {
    ok:
      nouveauMode === 'papier'
        ? 'Remise en papier (à imprimer).'
        : 'Remise en e-billet (par email).',
  }
}
