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
})

export async function validerPlacement(input: {
  bookingId: string
  seatIds: string[]
  mode: 'emission' | 'deplacement'
}): Promise<PlacementActionResult> {
  await requireAdmin()

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Demande invalide.' }
  }
  const { bookingId, seatIds, mode } = parsed.data

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
  try {
    if (mode === 'emission') await sendTicketsEmail(booking)
    else await sendMovedEmail(booking)
  } catch {
    // Tolérée : les billets restent accessibles via la page publique.
  }

  revalidatePath('/admin/plan')
  revalidatePath('/admin/demandes')
  redirect('/admin/demandes')
}
