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
  pmrCount?: number
  pmrCompanions?: number
}

type Resultat =
  | { error: string; dejaEnCours?: boolean }
  | { booking: { publicToken: string }; representationTitle: string }

export async function creerBookingEnAttente(demande: NouvelleDemande): Promise<Resultat> {
  const now = new Date()
  // Email normalisé en minuscules : clé d'identification d'une demande
  // (détection de doublon + accès « j'ai déjà une demande »).
  const email = demande.email.trim().toLowerCase()
  const result = await prisma.$transaction(async (tx) => {
    const representation = await tx.representation.findUnique({
      where: { id: demande.representationId },
    })
    if (!representation || !representation.isOpen) {
      return { ok: false as const, error: "Cette représentation n'est pas ouverte à la réservation." }
    }

    // Une seule demande active par email : on évite les doublons. Une demande
    // en attente (non expirée) ou déjà payée/placée bloque une nouvelle.
    const existante = await tx.booking.findFirst({
      where: {
        representationId: representation.id,
        email,
        OR: [
          { status: 'pending', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { status: { in: ['paid', 'placed'] } },
        ],
      },
      select: { status: true },
    })
    if (existante) {
      return {
        ok: false as const,
        dejaEnCours: true,
        error:
          existante.status === 'pending'
            ? 'Une demande est déjà en cours pour cet email. Utilisez l’onglet « J’ai déjà une demande » ci-dessus pour la modifier.'
            : 'Une demande déjà réglée existe pour cet email. Pour tout changement, contactez les permanences de l’école.',
      }
    }

    const jauge = await computeJauge(tx, representation.id)
    if (jauge < demande.partySize) {
      return { ok: false as const, error: 'Plus assez de places disponibles' }
    }

    // Nb de PMR borné au groupe ; accompagnants bornés au reste (places non PMR).
    const pmrCount = Math.min(Math.max(0, Math.trunc(demande.pmrCount ?? 0)), demande.partySize)
    const pmrCompanions =
      pmrCount > 0 ? Math.min(Math.max(0, demande.pmrCompanions ?? 0), demande.partySize - pmrCount) : 0

    const booking = await tx.booking.create({
      data: {
        representationId: representation.id,
        name: demande.name,
        email,
        phone: demande.phone,
        partySize: demande.partySize,
        notes: demande.notes ?? null,
        pmrCount,
        pmrCompanions,
        status: 'pending',
        publicToken: randomUUID(),
        expiresAt: new Date(Date.now() + QUATORZE_JOURS_MS),
      },
    })
    return { ok: true as const, booking, representation }
  })

  if (!result.ok) {
    return { error: result.error, ...('dejaEnCours' in result ? { dejaEnCours: true } : {}) }
  }

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
