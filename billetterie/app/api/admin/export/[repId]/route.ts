// GET /api/admin/export/[repId] — export CSV des demandes d'une
// représentation, pensé pour Excel FR : séparateur « ; », BOM UTF-8,
// échappement par guillemets doublés.
//
// getAdminSession() → 401 si pas de session : défense en profondeur,
// proxy.ts filtre déjà /api/admin/*.

import { getAdminSession } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

const REP_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

const dateCourte = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// Échappement CSV : guillemets si la valeur contient « ; », guillemet ou
// retour à la ligne ; les guillemets internes sont doublés. Une valeur
// commençant par = + - @ est préfixée d'une apostrophe : sinon Excel
// l'interprète comme une formule (CSV formula injection — un nom de famille
// saisi sur le formulaire public finit dans cet export).
function champCsv(valeur: string): string {
  const sain = /^[=+\-@]/.test(valeur) ? `'${valeur}` : valeur
  if (/[";\r\n]/.test(sain)) return `"${sain.replaceAll('"', '""')}"`
  return sain
}

function capitaliser(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}

const STATUTS: Record<string, string> = {
  pending: 'En attente',
  paid: 'Payée',
  placed: 'Placée',
  cancelled: 'Annulée',
  expired: 'Expirée',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repId: string }> },
) {
  const session = await getAdminSession()
  if (!session) return new Response('Non autorisé', { status: 401 })

  const { repId } = await params
  if (!REP_ID_RE.test(repId)) return new Response('Introuvable', { status: 404 })

  const representation = await prisma.representation.findUnique({ where: { id: repId } })
  if (!representation) return new Response('Introuvable', { status: 404 })

  const bookings = await prisma.booking.findMany({
    where: { representationId: repId },
    orderBy: { createdAt: 'asc' },
    include: {
      tickets: {
        orderBy: [{ seat: { rowId: 'asc' } }, { seat: { number: 'asc' } }],
        select: {
          scannedAt: true,
          seat: {
            select: {
              number: true,
              row: { select: { label: true, section: { select: { name: true } } } },
            },
          },
        },
      },
    },
  })

  const lignes = [['Nom', 'Email', 'Téléphone', 'Statut', 'Places', 'Payé le', 'Scanné']]
  for (const b of bookings) {
    const places = b.tickets
      .map((t) => `${capitaliser(t.seat.row.section.name)} ${t.seat.row.label} ${t.seat.number}`)
      .join(' / ')
    const scannes = b.tickets.filter((t) => t.scannedAt !== null).length
    lignes.push([
      b.name,
      b.email,
      b.phone,
      STATUTS[b.status] ?? b.status,
      places,
      b.paidAt ? dateCourte.format(b.paidAt) : '',
      b.tickets.length > 0 ? `${scannes}/${b.tickets.length}` : '',
    ])
  }

  // BOM UTF-8 : sans lui, Excel FR ouvre le fichier en latin-1.
  const csv = '\uFEFF' + lignes.map((l) => l.map(champCsv).join(';')).join('\r\n') + '\r\n'

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="demandes-${repId}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
