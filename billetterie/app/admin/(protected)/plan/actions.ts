'use server'

// Server actions du mode « gérer les blocages » de la vue plan.
//
// Chaque action re-vérifie la session (défense en profondeur après
// proxy.ts et le layout) puis valide l'entrée avec zod.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

export type OverrideResult = { ok: true } | { ok: false; error: string }

const baseSchema = z.object({
  repId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1, 'Sélectionnez au moins un siège.'),
})

const bloquerSchema = baseSchema.extend({
  reason: z.string().trim().min(1, 'Indiquez une raison.').max(120),
})

export async function bloquerSieges(input: {
  repId: string
  seatIds: string[]
  reason: string
}): Promise<OverrideResult> {
  await requireAdmin()

  const parsed = bloquerSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Demande invalide.' }
  }
  const { repId, seatIds, reason } = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      const representation = await tx.representation.findUnique({ where: { id: repId } })
      if (!representation) throw new Error('Représentation introuvable.')

      // Interdit de bloquer un siège déjà ticketé pour cette représentation.
      const ticketed = await tx.ticket.findMany({
        where: { representationId: repId, seatId: { in: seatIds } },
        select: { seatId: true },
      })
      if (ticketed.length > 0) {
        throw new Error(
          `Impossible de bloquer des sièges déjà attribués (${ticketed.map((t) => t.seatId).join(', ')}).`,
        )
      }

      // Déjà bloqués → ignorés (createMany + skipDuplicates n'existe pas en SQLite).
      const existing = await tx.seatOverride.findMany({
        where: { representationId: repId, seatId: { in: seatIds } },
        select: { seatId: true },
      })
      const alreadyBlocked = new Set(existing.map((o) => o.seatId))
      const toCreate = seatIds.filter((id) => !alreadyBlocked.has(id))

      if (toCreate.length > 0) {
        await tx.seatOverride.createMany({
          data: toCreate.map((seatId) => ({ representationId: repId, seatId, reason })),
        })
      }
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erreur lors du blocage.' }
  }

  revalidatePath('/admin/plan')
  return { ok: true }
}

export async function debloquerSieges(input: {
  repId: string
  seatIds: string[]
}): Promise<OverrideResult> {
  await requireAdmin()

  const parsed = baseSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Demande invalide.' }
  }
  const { repId, seatIds } = parsed.data

  await prisma.seatOverride.deleteMany({
    where: { representationId: repId, seatId: { in: seatIds } },
  })

  revalidatePath('/admin/plan')
  return { ok: true }
}

const amovibleSchema = z.object({
  seatId: z.string().min(1).max(64),
  removable: z.boolean(),
})

// Bascule le caractère AMOVIBLE d'un siège — propriété physique du fauteuil,
// donc globale (toutes représentations), contrairement aux blocages.
// ⚠️ `pnpm db:seed` réécrit ce champ depuis la config : les retouches faites
// ici sont perdues à chaque re-seed (même contrat que les scores).
export async function basculerAmovible(input: {
  seatId: string
  removable: boolean
}): Promise<OverrideResult> {
  await requireAdmin()

  const parsed = amovibleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Demande invalide.' }
  }

  try {
    await prisma.seat.update({
      where: { id: parsed.data.seatId },
      data: { removable: parsed.data.removable },
    })
  } catch {
    return { ok: false, error: 'Siège introuvable.' }
  }

  revalidatePath('/admin/plan')
  return { ok: true }
}
