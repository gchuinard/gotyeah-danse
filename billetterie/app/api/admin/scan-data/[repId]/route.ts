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

  // Annuaire : TOUTES les demandes (toutes représentations, tous statuts), pour
  // indiquer au scan « cette personne existe mais n'est pas scannable ici »
  // (non placée, autre date, annulée). Léger : nom / contact / statut / rep.
  const [tickets, annuaire] = await Promise.all([
    prisma.ticket.findMany({
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
    }),
    prisma.booking.findMany({
      select: {
        name: true,
        phone: true,
        email: true,
        status: true,
        representation: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

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
      directory: annuaire.map((b) => ({
        name: b.name,
        phone: b.phone,
        email: b.email,
        status: b.status,
        repTitle: b.representation.title,
      })),
      ts: Date.now(),
    },
    { headers: NO_STORE },
  )
}
