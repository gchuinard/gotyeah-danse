// Jobs quotidiens du cron — logique PURE et testable : le client Prisma et
// l'expéditeur d'e-mail sont INJECTÉS (client global + sendReminderEmail en
// prod via scripts/cron.ts, fakes dans les tests). Pas d'email envoyé ici.

import type { PrismaClient } from '@prisma/client'

import { DEMANDES_ACTIVES } from '@/lib/admin/archive'

const SEPT_JOURS_MS = 7 * 24 * 60 * 60 * 1000

// pending dont expiresAt est passé → status 'expired'. Retourne le nombre.
// La jauge les ignorait déjà par date ; le statut acte la chose. Pas d'email :
// la page de suivi et le back-office suffisent à constater l'expiration.
//
// Les représentations ARCHIVÉES sont exclues : leurs demandes sont gelées, le
// cron ne doit pas les faire bouger (et surtout pas les relancer par email —
// cf. relancerDemandes).
export async function expirerDemandes(db: PrismaClient, now = new Date()): Promise<number> {
  const { count } = await db.booking.updateMany({
    where: { status: 'pending', expiresAt: { lt: now }, ...DEMANDES_ACTIVES },
    data: { status: 'expired' },
  })
  return count
}

// Shape structurel passé au sender — compatible avec sendReminderEmail
// (lib/email/booking.ts) sans dépendre de son module.
export type ReminderBooking = {
  name: string
  email: string
  partySize: number
  publicToken: string
  expiresAt: Date | null
  representation: { title: string; startsAt: Date }
}

// Relance J+7 : pending non expirées, jamais relancées (remindedAt null),
// créées il y a ≥ 7 jours. remindedAt n'est posé QUE si l'envoi a réussi —
// un échec (false ou throw) sera retenté au prochain passage. Envois
// séquentiels : volumes minuscules, logs lisibles, pas de rafale Brevo.
//
// Représentations ARCHIVÉES exclues : relancer une famille au sujet d'un
// spectacle clôturé serait le pire effet de bord de l'archivage.
export async function relancerDemandes(
  db: PrismaClient,
  send: (booking: ReminderBooking) => Promise<boolean>,
  now = new Date(),
): Promise<{ envoyees: number; echecs: number }> {
  const aRelancer = await db.booking.findMany({
    where: {
      status: 'pending',
      remindedAt: null,
      createdAt: { lte: new Date(now.getTime() - SEPT_JOURS_MS) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...DEMANDES_ACTIVES,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      partySize: true,
      publicToken: true,
      expiresAt: true,
      representation: { select: { title: true, startsAt: true } },
    },
  })

  let envoyees = 0
  let echecs = 0
  for (const { id, ...booking } of aRelancer) {
    let ok = false
    try {
      ok = await send(booking)
    } catch {
      ok = false
    }
    if (ok) {
      await db.booking.update({ where: { id }, data: { remindedAt: new Date() } })
      envoyees += 1
    } else {
      echecs += 1
    }
  }
  return { envoyees, echecs }
}
