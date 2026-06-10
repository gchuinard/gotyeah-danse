// GET /api/admin/plan-state/[repId] — endpoint léger pour le polling (5 s)
// du plan de salle multi-bénévoles.
//
// Ne retourne QUE des seatIds (jamais de noms de familles) : la fraîcheur
// des statuts suffit côté client, les occupants arrivent au rechargement.

import { getAdminSession } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repId: string }> },
) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: 'Non autorisé' }, { status: 401, headers: NO_STORE })
  }

  const { repId } = await params

  const [tickets, overrides] = await Promise.all([
    prisma.ticket.findMany({
      where: { representationId: repId },
      select: { seatId: true },
    }),
    prisma.seatOverride.findMany({
      where: { representationId: repId },
      select: { seatId: true },
    }),
  ])

  return Response.json(
    {
      occupied: tickets.map((t) => t.seatId),
      blocked: overrides.map((o) => o.seatId),
      ts: Date.now(),
    },
    { headers: NO_STORE },
  )
}
