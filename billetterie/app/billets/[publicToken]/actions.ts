'use server'

// Modification / annulation d'une demande par le demandeur lui-même, TANT
// QU'ELLE EST EN ATTENTE (pending, non expirée). L'accès est protégé par le
// token UUID de la page (obtenu via l'onglet « j'ai déjà une demande »,
// email + téléphone). Une fois payée/placée : plus modifiable ici.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { computeJauge } from '@/lib/jauge'
import { MAX_PARTY_SIZE } from '@/lib/public/limits'
import { FR_PHONE_RE, formatFrPhone, normalizeFrPhone } from '@/lib/public/phone'

export type ModifResult = { ok: true } | { ok: false; error: string }

const modifSchema = z.object({
  token: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Indiquez un nom.').max(120, 'Nom trop long.'),
  phone: z
    .string()
    .trim()
    .transform(normalizeFrPhone)
    .refine((d) => FR_PHONE_RE.test(d), 'Numéro invalide. Format attendu : 06 12 34 56 78.')
    .transform(formatFrPhone),
  partySize: z.coerce.number().int().min(1).max(MAX_PARTY_SIZE),
  notes: z
    .string()
    .trim()
    .max(500, 'Le commentaire ne peut pas dépasser 500 caractères.')
    .optional()
    .transform((v) => (v ? v : null)),
  pmrCount: z.coerce.number().int().min(0).max(MAX_PARTY_SIZE).optional().default(0),
  pmrCompanions: z.coerce.number().int().min(0).max(MAX_PARTY_SIZE).optional().default(0),
})

export async function modifierDemande(input: {
  token: string
  name: string
  phone: string
  partySize: number
  notes?: string
  pmrCount: number
  pmrCompanions: number
}): Promise<ModifResult> {
  const parsed = modifSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Demande invalide.' }
  }
  const d = parsed.data
  const now = new Date()

  try {
    await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { publicToken: d.token } })
      if (!booking) throw new Error('Demande introuvable.')
      if (booking.status !== 'pending' || (booking.expiresAt && booking.expiresAt <= now)) {
        throw new Error('Cette demande n’est plus modifiable (déjà réglée ou expirée).')
      }

      // Jauge : sa propre empreinte actuelle (partySize) est déjà comptée.
      const jauge = await computeJauge(tx, booking.representationId, now)
      const maxPourCetteDemande = jauge + booking.partySize
      if (d.partySize > maxPourCetteDemande) {
        throw new Error(`Plus assez de places : ${maxPourCetteDemande} au maximum pour cette demande.`)
      }

      const pmrCount = Math.min(Math.max(0, d.pmrCount), d.partySize)
      const pmrCompanions =
        pmrCount > 0 ? Math.min(Math.max(0, d.pmrCompanions), d.partySize - pmrCount) : 0
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          name: d.name,
          phone: d.phone,
          partySize: d.partySize,
          notes: d.notes,
          pmrCount,
          pmrCompanions,
        },
      })
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Modification impossible.' }
  }

  revalidatePath('/billets/' + d.token)
  return { ok: true }
}

export async function annulerDemande(token: string): Promise<ModifResult> {
  if (typeof token !== 'string' || !token) return { ok: false, error: 'Demande invalide.' }
  try {
    await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { publicToken: token } })
      if (!booking) throw new Error('Demande introuvable.')
      if (booking.status !== 'pending') {
        throw new Error('Seule une demande en attente peut être annulée ici.')
      }
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'cancelled' } })
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Annulation impossible.' }
  }
  revalidatePath('/billets/' + token)
  return { ok: true }
}
