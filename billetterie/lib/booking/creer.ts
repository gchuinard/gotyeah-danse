// Création d'une demande « en attente » — logique partagée entre le formulaire
// public (app/demande/actions.ts) et la création depuis le back-office
// (app/admin/(protected)/demandes/nouvelle/actions.ts).
//
// Vérification de jauge + création dans la MÊME transaction : deux demandes
// simultanées ne peuvent pas dépasser la capacité. L'email de confirmation est
// « best effort » (son échec ne fait jamais échouer la demande).

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/db'
import { sendBookingPendingEmail } from '@/lib/email/booking'
import { computeJauge } from '@/lib/jauge'

const QUATORZE_JOURS_MS = 14 * 24 * 60 * 60 * 1000

export type NouvelleDemande = {
  representationId: string
  name: string
  email: string
  phone: string
  partySize: number
  notes?: string
}

type Resultat =
  | { error: string }
  | { booking: { publicToken: string }; representationTitle: string }

export async function creerBookingEnAttente(demande: NouvelleDemande): Promise<Resultat> {
  const result = await prisma.$transaction(async (tx) => {
    const representation = await tx.representation.findUnique({
      where: { id: demande.representationId },
    })
    if (!representation || !representation.isOpen) {
      return { ok: false as const, error: "Cette représentation n'est pas ouverte à la réservation." }
    }

    const jauge = await computeJauge(tx, representation.id)
    if (jauge < demande.partySize) {
      return { ok: false as const, error: 'Plus assez de places disponibles' }
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
    return { ok: true as const, booking, representation }
  })

  if (!result.ok) return { error: result.error }

  // Email « demande enregistrée » : best effort, on ne logge rien de personnel.
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

  return { booking: result.booking, representationTitle: result.representation.title }
}
