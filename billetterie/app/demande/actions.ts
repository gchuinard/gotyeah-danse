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

import { randomUUID } from 'node:crypto'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { sendBookingPendingEmail } from '@/lib/email/booking'
import { computeJauge } from '@/lib/jauge'
import { bookingSchema, type BookingInput } from '@/lib/public/booking-schema'
import { rateLimit } from '@/lib/rate-limit'

const QUATORZE_JOURS_MS = 14 * 24 * 60 * 60 * 1000

export type DemandeState = {
  // true = confirmation générique affichée par l'UI. N'arrive que pour le
  // succès factice du honeypot : un vrai succès part en redirect.
  ok: boolean
  // Erreur globale (rate-limit, représentation fermée, jauge insuffisante…).
  error?: string
  // Erreurs de validation, par champ.
  fieldErrors?: { [K in keyof BookingInput]?: string[] }
}

export async function creerDemande(
  _prevState: DemandeState,
  formData: FormData,
): Promise<DemandeState> {
  // Rate-limit par IP : premier élément de x-forwarded-for.
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'inconnue'
  if (!rateLimit(`demande:${ip}`, { limit: 5, windowMs: 10 * 60_000 })) {
    return { ok: false, error: 'Trop de demandes, réessayez dans quelques minutes.' }
  }

  // Honeypot : un humain ne remplit jamais ce champ (masqué hors écran).
  // Succès factice AVANT zod, pour ne donner aucun indice au robot.
  const website = formData.get('website')
  if (typeof website === 'string' && website.length > 0) {
    return { ok: true }
  }

  const parsed = bookingSchema.safeParse({
    representationId: formData.get('representationId'),
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    partySize: formData.get('partySize'),
    notes: formData.get('notes') ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Veuillez corriger les champs signalés.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    }
  }
  const demande = parsed.data

  // Vérification de jauge + création dans la MÊME transaction : deux familles
  // qui soumettent en même temps ne peuvent pas dépasser la capacité.
  const result = await prisma.$transaction(async (tx) => {
    const representation = await tx.representation.findUnique({
      where: { id: demande.representationId },
    })
    if (!representation || !representation.isOpen) {
      return { error: "Cette représentation n'est pas ouverte à la réservation." } as const
    }

    const jauge = await computeJauge(tx, representation.id)
    if (jauge < demande.partySize) {
      return { error: 'Plus assez de places disponibles' } as const
    }

    const booking = await tx.booking.create({
      data: {
        representationId: representation.id,
        name: demande.name,
        email: demande.email,
        phone: demande.phone,
        partySize: demande.partySize,
        notes: demande.notes ?? null,
        status: 'pending',
        publicToken: randomUUID(),
        expiresAt: new Date(Date.now() + QUATORZE_JOURS_MS),
      },
    })
    return { booking, representation } as const
  })

  if ('error' in result) {
    return { ok: false, error: result.error }
  }

  // Email « demande enregistrée » : best effort, son échec ne doit jamais
  // faire échouer la demande (et on ne logge rien de personnel).
  try {
    await sendBookingPendingEmail({
      name: result.booking.name,
      email: result.booking.email,
      partySize: result.booking.partySize,
      publicToken: result.booking.publicToken,
      expiresAt: result.booking.expiresAt,
      representation: {
        title: result.representation.title,
        startsAt: result.representation.startsAt,
      },
    })
  } catch {
    // Ignoré volontairement.
  }

  // Hors du try/catch : redirect() fonctionne en levant une exception.
  redirect('/billets/' + result.booking.publicToken)
}
