// Prix unitaire d'une place pour le spectacle. Un SEUL prix pour tout
// l'événement (pas de tarif par représentation), rangé dans Setting
// "ticket_price_cents" — réglé par le super-admin depuis /admin/representations,
// sans redeploy. Tant qu'aucun prix n'est défini, le montant dû reste « inconnu »
// (l'UI dégrade proprement : pas de montant attribué, saisie libre comme avant).
// Logique pure DB (client injecté) : testable sur DB jetable.

import type { PrismaClient } from '@prisma/client'

export const TICKET_PRICE_KEY = 'ticket_price_cents'

// Prix en centimes, entier ≥ 0. null = non défini (clé absente ou valeur
// illisible). On ne devine jamais un prix : pas de valeur par défaut cachée.
export async function getTicketPriceCents(db: PrismaClient): Promise<number | null> {
  const row = await db.setting.findUnique({ where: { key: TICKET_PRICE_KEY } })
  if (!row) return null
  const n = Number(row.value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export async function setTicketPriceCents(db: PrismaClient, cents: number): Promise<void> {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error('Le prix doit être un montant positif.')
  }
  const value = String(cents)
  await db.setting.upsert({
    where: { key: TICKET_PRICE_KEY },
    create: { key: TICKET_PRICE_KEY, value },
    update: { value },
  })
}

export async function clearTicketPrice(db: PrismaClient): Promise<void> {
  await db.setting.deleteMany({ where: { key: TICKET_PRICE_KEY } })
}
