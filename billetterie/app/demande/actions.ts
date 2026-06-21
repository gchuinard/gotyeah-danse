'use server'

// Action serveur du formulaire public de demande de places.
//
// Ordre de traitement, volontairement strict :
//   1. rate-limit par IP (avant tout travail) ;
//   2. honeypot → succès FACTICE (rien créé, rien révélé au robot) ;
//   3. validation zod → erreurs par champ ;
//   4. transaction : représentation ouverte + jauge suffisante + création ;
//   5. email de confirmation « best effort » puis redirect vers /billets/…
//
// ⚠️ Ne JAMAIS logger les données personnelles ni le publicToken.

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { demandeEnAttentePourEmail, trouverDemandeParCode } from '@/lib/booking/acces'
import { ACTOR_PUBLIC } from '@/lib/admin/events'
import { creerBookingEnAttente } from '@/lib/booking/creer'
import { sendBookingPendingEmail } from '@/lib/email/booking'
import { clientIp } from '@/lib/net/client-ip'
import { bookingSchema, type BookingInput } from '@/lib/public/booking-schema'
import { verifyTurnstile } from '@/lib/public/turnstile'
import { rateLimit } from '@/lib/rate-limit'

// Délai minimal plausible entre l'affichage du formulaire et sa soumission.
const MIN_FILL_MS = 2_500

export type DemandeState = {
  // true = confirmation générique affichée par l'UI. N'arrive que pour le
  // succès factice du honeypot : un vrai succès part en redirect.
  ok: boolean
  // Erreur globale (rate-limit, représentation fermée, jauge insuffisante…).
  error?: string
  // Une demande existe déjà pour cet email → on invite à utiliser l'onglet.
  dejaEnCours?: boolean
  // Erreurs de validation, par champ.
  fieldErrors?: { [K in keyof BookingInput]?: string[] }
}

// Onglet « J'ai déjà une demande » : accès par email + IDENTIFIANT (reçu par
// mail à la création). Aucun email envoyé ici. Rate-limité (anti-énumération
// du code). Succès → redirect vers la page de la demande (token).
export type AccesState = { error?: string; renvoye?: boolean }

export async function accederDemande(
  _prevState: AccesState,
  formData: FormData,
): Promise<AccesState> {
  const ip = await clientIp()
  if (!rateLimit(`acces:${ip}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return { error: 'Trop de tentatives, réessayez dans quelques minutes.' }
  }

  const email = String(formData.get('email') ?? '')
  const code = String(formData.get('code') ?? '')
  if (!email.trim() || !code.trim()) {
    return { error: 'Renseignez votre email ET votre identifiant de demande.' }
  }

  const resultat = await trouverDemandeParCode(email, code)
  if (resultat.type === 'trouvee') {
    redirect('/billets/' + resultat.publicToken)
  }
  return {
    error:
      'Email ou identifiant incorrect. Identifiant perdu ? Demandez son renvoi ci-dessous.',
  }
}

// « Identifiant oublié » : on renvoie l'identifiant par mail (rare, donc OK
// malgré la limite d'envoi). Réponse TOUJOURS générique (anti-énumération).
export async function renvoyerIdentifiant(
  _prevState: AccesState,
  formData: FormData,
): Promise<AccesState> {
  const ip = await clientIp()
  if (!rateLimit(`renvoi:${ip}`, { limit: 5, windowMs: 15 * 60_000 })) {
    return { error: 'Trop de demandes, réessayez dans quelques minutes.' }
  }

  const email = String(formData.get('email') ?? '')
  const booking = await demandeEnAttentePourEmail(email)
  if (booking) {
    try {
      await sendBookingPendingEmail({
        name: booking.name,
        email: booking.email,
        partySize: booking.partySize,
        publicToken: booking.publicToken,
        expiresAt: booking.expiresAt,
        representation: booking.representation,
      })
    } catch {
      // best effort
    }
  }
  // Message générique, qu'une demande existe ou non.
  return { renvoye: true }
}

export async function creerDemande(
  _prevState: DemandeState,
  formData: FormData,
): Promise<DemandeState> {
  // Rate-limit par IP : premier élément de x-forwarded-for.
  const ip = await clientIp()
  if (!rateLimit(`demande:${ip}`, { limit: 5, windowMs: 10 * 60_000 })) {
    return { ok: false, error: 'Trop de demandes, réessayez dans quelques minutes.' }
  }

  // Honeypot : un humain ne remplit jamais ce champ (masqué hors écran).
  // Succès factice AVANT zod, pour ne donner aucun indice au robot.
  const website = formData.get('website')
  if (typeof website === 'string' && website.length > 0) {
    return { ok: true }
  }

  // Time-trap : un robot soumet en quelques millisecondes. Si le formulaire a
  // été « rempli » trop vite, succès factice (comme le honeypot). Le champ `ts`
  // est posé au montage côté client ; absent (ex. JS lent), on ne bloque pas.
  const ts = Number(formData.get('ts'))
  if (Number.isFinite(ts) && ts > 0 && Date.now() - ts < MIN_FILL_MS) {
    return { ok: true }
  }

  const parsed = bookingSchema.safeParse({
    representationId: formData.get('representationId'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    partySize: formData.get('partySize'),
    notes: formData.get('notes') ?? undefined,
    pmrCount: formData.get('pmrCount') ?? undefined,
    pmrCompanions: formData.get('pmrCompanions') ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Veuillez corriger les champs signalés.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    }
  }
  const demande = parsed.data

  // Turnstile (CAPTCHA invisible Cloudflare) APRÈS zod : le jeton (usage unique,
  // valable ~5 min) n'est consommé que pour une soumission par ailleurs valide
  // — une faute de frappe corrigée puis renvoyée réutilise le même jeton.
  // Sans TURNSTILE_SECRET_KEY (dev), verifyTurnstile renvoie true → aucun blocage.
  const token = formData.get('cf-turnstile-response')
  const humain = await verifyTurnstile(typeof token === 'string' ? token : undefined, ip)
  if (!humain) {
    return { ok: false, error: 'Vérification anti-robot échouée. Rechargez la page et réessayez.' }
  }

  const result = await creerBookingEnAttente({
    representationId: demande.representationId,
    name: `${demande.firstName} ${demande.lastName}`,
    email: demande.email,
    phone: demande.phone,
    partySize: demande.partySize,
    notes: demande.notes,
    pmrCount: demande.pmrCount,
    pmrCompanions: demande.pmrCompanions,
  }, ACTOR_PUBLIC)

  if ('error' in result) {
    return { ok: false, error: result.error, ...(result.dejaEnCours ? { dejaEnCours: true } : {}) }
  }

  // Hors du try/catch : redirect() fonctionne en levant une exception.
  redirect('/billets/' + result.booking.publicToken)
}
