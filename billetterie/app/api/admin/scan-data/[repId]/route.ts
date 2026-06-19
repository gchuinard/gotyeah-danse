// GET /api/admin/scan-data/[repId] — manifeste complet des billets d'une
// représentation, pour la page de scan du soir du spectacle.
//
// Le wifi de la salle étant une légende urbaine, le client télécharge TOUT
// (~600 entrées, négligeable) au chargement et valide ensuite chaque scan
// 100 % localement. scannedAt sert à détecter les billets déjà passés.

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

  const tickets = await prisma.ticket.findMany({
    where: { representationId: repId },
    select: {
      qrToken: true,
      scannedAt: true,
      booking: { select: { name: true, phone: true, email: true } },
      seat: {
        select: {
          number: true,
          row: { select: { label: true, section: { select: { name: true } } } },
        },
      },
    },
  })

  return Response.json(
    {
      tickets: tickets.map((t) => ({
        qrToken: t.qrToken,
        section: t.seat.row.section.name,
        rowLabel: t.seat.row.label,
        number: t.seat.number,
        name: t.booking.name,
        phone: t.booking.phone,
        email: t.booking.email,
        scannedAt: t.scannedAt ? t.scannedAt.toISOString() : null,
      })),
      ts: Date.now(),
    },
    { headers: NO_STORE },
  )
}
