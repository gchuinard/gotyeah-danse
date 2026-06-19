'use server'

// Validation d'un placement (émission ou déplacement de billets).
//
// La logique métier (transaction, contrainte @@unique([representationId,
// seatId]) qui rend les doublons impossibles entre deux bénévoles) vit dans
// lib/admin/bookings — ici : auth, validation zod, email best-effort,
// revalidation et redirection.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { deplacerBillets, emettreBillets } from '@/lib/admin/bookings'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { sendMovedEmail, sendTicketsEmail } from '@/lib/email/booking'

export type PlacementActionResult = { ok: false; error: string }

const schema = z.object({
  bookingId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1),
  mode: z.enum(['emission', 'deplacement']),
  retour: z.string().max(200).optional(),
})

// Reconstruit la query de retour à partir de la liste BLANCHE de filtres —
// on ne fait jamais confiance à la chaîne brute reçue du client.
function urlRetour(retour?: string): string {
  const safe = new URLSearchParams()
  if (retour) {
    const recu = new URLSearchParams(retour)
    for (const cle of ['statut', 'q'] as const) {
      const v = recu.get(cle)
      if (v) safe.set(cle, v)
    }
  }
  const qs = safe.toString()
  return '/admin/demandes' + (qs ? `?${qs}` : '')
}

export async function validerPlacement(input: {
  bookingId: string
  seatIds: string[]
  mode: 'emission' | 'deplacement'
  retour?: string
}): Promise<PlacementActionResult> {
  await requireAdmin()

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Demande invalide.' }
  }
  const { bookingId, seatIds, mode, retour } = parsed.data

  let booking
  try {
    booking =
      mode === 'emission'
        ? await emettreBillets(prisma, bookingId, seatIds)
        : await deplacerBillets(prisma, bookingId, seatIds)
  } catch (error) {
    // Erreur métier (siège pris entre-temps par un autre bénévole, statut
    // inattendu…) : l'admin voit le message, recharge et réessaie.
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Le placement a échoué — rechargez le plan et réessayez.',
    }
  }

  // Email best-effort : un échec d'envoi n'annule pas le placement.
  // ⚠️ Placement d'une demande NON réglée (paidAt vide) : on N'ENVOIE PAS les
  // billets automatiquement — l'admin le déclenchera à la main depuis la liste
  // (bouton « Envoyer les billets » + avertissement « pas de paiement »).
  try {
    if (mode === 'emission') {
      if (booking.paidAt) await sendTicketsEmail(booking)
    } else {
      await sendMovedEmail(booking)
    }
  } catch {
    // Tolérée : les billets restent accessibles via la page publique.
  }

  revalidatePath('/admin/plan')
  revalidatePath('/admin/demandes')
  redirect(urlRetour(retour))
}
