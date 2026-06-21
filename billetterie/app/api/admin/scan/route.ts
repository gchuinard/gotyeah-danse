// POST /api/admin/scan — enregistre un scan de billet.
//
// Le scan a déjà été validé LOCALEMENT par le téléphone du bénévole (la
// salle n'a pas de réseau fiable) : ce POST n'est que la synchronisation,
// possiblement bien après le passage réel. `scannedAt` est donc l'heure du
// scan CLIENT, pas l'heure du POST.
//
// Premier scan gagne : l'updateMany conditionné sur scannedAt: null est
// atomique — deux bénévoles qui synchronisent le même billet ne peuvent pas
// s'écraser. Idempotent : re-POSTer le même scan renvoie 'deja-scanne' avec
// la valeur qui fait foi en base, sans rien modifier.
//
// Ne JAMAIS logger le qrToken (il donne accès au billet).

import { z } from 'zod'

import { getAdminSession } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

const NO_STORE = { 'Cache-Control': 'no-store' }

const scanSchema = z.object({
  qrToken: z.uuid(),
  scannedAt: z.iso.datetime(),
})

export async function POST(request: Request) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: 'Non autorisé' }, { status: 401, headers: NO_STORE })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'JSON invalide' }, { status: 400, headers: NO_STORE })
  }

  const parsed = scanSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Corps de requête invalide' }, { status: 400, headers: NO_STORE })
  }

  const { qrToken } = parsed.data
  // Heure client bornée : jamais dans le futur (horloge déréglée), et au plus
  // 24 h dans le passé (resynchro offline légitime, pas plus).
  const now = Date.now()
  const clientTime = new Date(parsed.data.scannedAt).getTime()
  const scannedAt = new Date(Math.max(now - 24 * 60 * 60 * 1000, Math.min(clientTime, now)))

  // Premier scan gagne — atomique grâce à la condition scannedAt: null.
  // scannedBy = qui a scanné (prénom du bénévole ou email admin), pour l'audit.
  const { count } = await prisma.ticket.updateMany({
    where: { qrToken, scannedAt: null },
    data: { scannedAt, scannedBy: session.name },
  })
  if (count === 1) {
    return Response.json(
      { status: 'ok', scannedAt: scannedAt.toISOString() },
      { headers: NO_STORE },
    )
  }

  // count = 0 : soit le billet n'existe pas, soit il est déjà scanné.
  const ticket = await prisma.ticket.findUnique({
    where: { qrToken },
    select: { scannedAt: true },
  })
  if (!ticket) {
    return Response.json({ status: 'inconnu', scannedAt: null }, { headers: NO_STORE })
  }
  return Response.json(
    { status: 'deja-scanne', scannedAt: ticket.scannedAt?.toISOString() ?? null },
    { headers: NO_STORE },
  )
}
