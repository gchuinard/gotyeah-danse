// Tarifs d'une place pour le spectacle. DEUX tarifs GLOBAUX (un seul jeu pour
// tout l'événement, pas par représentation) : ADULTE et ENFANT, rangés dans
// Setting et réglés par le super-admin depuis /admin/representations, sans
// redeploy. Tant qu'un tarif n'est pas défini, le montant dû correspondant
// reste « inconnu » (l'UI dégrade proprement). On ne devine jamais un prix.
//
// Migration douce : l'ancien prix unique "ticket_price_cents" est lu EN REPLI
// comme tarif adulte — inutile de re-saisir après mise à jour. Dès que l'admin
// enregistre les tarifs, l'ancienne clé est supprimée.
//
// Logique pure DB (client injecté) : testable sur DB jetable.

import type { PrismaClient } from '@prisma/client'

export const TICKET_PRICE_ADULT_KEY = 'ticket_price_adult_cents'
export const TICKET_PRICE_CHILD_KEY = 'ticket_price_child_cents'
export const TICKET_PRICE_LEGACY_KEY = 'ticket_price_cents' // prix unique hérité

export type TicketPrices = {
  adultCents: number | null
  childCents: number | null
}

// Centimes entiers ≥ 0, sinon null (valeur absente ou illisible).
function parseCents(value: string | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export async function getTicketPrices(db: PrismaClient): Promise<TicketPrices> {
  const rows = await db.setting.findMany({
    where: {
      key: { in: [TICKET_PRICE_ADULT_KEY, TICKET_PRICE_CHILD_KEY, TICKET_PRICE_LEGACY_KEY] },
    },
  })
  const value = (key: string) => rows.find((r) => r.key === key)?.value
  // Repli : sans tarif adulte explicite, l'ancien prix unique fait foi.
  const adultCents =
    parseCents(value(TICKET_PRICE_ADULT_KEY)) ?? parseCents(value(TICKET_PRICE_LEGACY_KEY))
  const childCents = parseCents(value(TICKET_PRICE_CHILD_KEY))
  return { adultCents, childCents }
}

async function upsertOrClear(db: PrismaClient, key: string, cents: number | null): Promise<void> {
  if (cents == null) {
    await db.setting.deleteMany({ where: { key } })
    return
  }
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error('Le prix doit être un montant positif.')
  }
  const value = String(cents)
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

// Enregistre les deux tarifs (null = effacer ce tarif). Retire toujours
// l'ancienne clé unique : une fois les tarifs gérés ici, elle n'a plus lieu d'être.
export async function setTicketPrices(db: PrismaClient, prices: TicketPrices): Promise<void> {
  await upsertOrClear(db, TICKET_PRICE_ADULT_KEY, prices.adultCents)
  await upsertOrClear(db, TICKET_PRICE_CHILD_KEY, prices.childCents)
  await db.setting.deleteMany({ where: { key: TICKET_PRICE_LEGACY_KEY } })
}
