'use server'

// Server action du mode « gérer les sièges » de la vue plan.
//
// Un seul geste (cyclerSiege) fait défiler les trois états d'un siège :
//   valide → bloqué → amovible → valide
// Le blocage est PAR représentation (SeatOverride) ; l'amovible est une
// propriété PHYSIQUE du fauteuil, donc globale (toutes représentations).
// L'état courant est relu en base dans la transaction pour éviter tout
// désaccord avec le client (deux bénévoles en parallèle).
//
// L'action re-vérifie la session (défense en profondeur après proxy.ts et le
// layout) puis valide l'entrée avec zod.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

const cyclerSchema = z.object({
  repId: z.string().min(1),
  seatId: z.string().min(1).max(64),
  reason: z.string().trim().min(1).max(120),
})

export type EtatSiege = 'valide' | 'bloque' | 'amovible'
export type CycleResult =
  | { ok: true; state: EtatSiege; reason?: string }
  | { ok: false; error: string }

export async function cyclerSiege(input: {
  repId: string
  seatId: string
  reason: string
}): Promise<CycleResult> {
  await requireAdmin()

  const parsed = cyclerSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Demande invalide.' }
  }
  const { repId, seatId, reason } = parsed.data

  try {
    const result = await prisma.$transaction(
      async (tx): Promise<{ state: EtatSiege; reason?: string }> => {
        const seat = await tx.seat.findUnique({ where: { id: seatId } })
        if (!seat) throw new Error('Siège introuvable.')

        const ticket = await tx.ticket.findFirst({
          where: { representationId: repId, seatId },
          select: { id: true },
        })
        if (ticket) throw new Error('Siège déjà attribué — impossible de le modifier.')

        const override = await tx.seatOverride.findUnique({
          where: { representationId_seatId: { representationId: repId, seatId } },
          select: { id: true },
        })

        // bloqué → amovible : on lève le blocage ET on pose la propriété amovible.
        if (override) {
          await tx.seatOverride.delete({ where: { id: override.id } })
          await tx.seat.update({ where: { id: seatId }, data: { removable: true } })
          return { state: 'amovible' }
        }
        // amovible → valide
        if (seat.removable) {
          await tx.seat.update({ where: { id: seatId }, data: { removable: false } })
          return { state: 'valide' }
        }
        // valide → bloqué (pour cette représentation), avec la raison choisie.
        const rep = await tx.representation.findUnique({
          where: { id: repId },
          select: { id: true },
        })
        if (!rep) throw new Error('Représentation introuvable.')
        await tx.seatOverride.create({ data: { representationId: repId, seatId, reason } })
        return { state: 'bloque', reason }
      },
    )

    revalidatePath('/admin/plan')
    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erreur lors de la bascule.' }
  }
}
