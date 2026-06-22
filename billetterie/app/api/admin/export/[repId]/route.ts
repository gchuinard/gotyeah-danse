// GET /api/admin/export/[repId] — export CSV des demandes d'une
// représentation, pensé pour Excel FR : séparateur « ; », BOM UTF-8,
// échappement par guillemets doublés.
//
// getAdminSession() → 401 si pas de session : défense en profondeur,
// proxy.ts filtre déjà /api/admin/*.

import { resumePaiement } from '@/lib/admin/money'
import { getTicketPriceCents } from '@/lib/admin/pricing'
import { getAdminSession } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { formatFrPhone } from '@/lib/public/phone'

const REP_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

const dateCourte = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const jourCourt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

// Montant en centimes → nombre décimal FR (virgule, sans symbole €) : Excel le
// lit comme un nombre. Vide si null.
function montantCsv(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',')
}

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
  paid: 'À placer',
  placed: 'Placée',
  cancelled: 'Annulée',
  expired: 'Expirée',
}

const METHODES: Record<string, string> = {
  especes: 'Espèces',
  cheque: 'Chèque',
  autre: 'Autre',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repId: string }> },
) {
  const session = await getAdminSession()
  if (!session) return new Response('Non autorisé', { status: 401 })
  if (session.role === 'scan') return new Response('Accès refusé', { status: 403 })

  const { repId } = await params
  if (!REP_ID_RE.test(repId)) return new Response('Introuvable', { status: 404 })

  const representation = await prisma.representation.findUnique({ where: { id: repId } })
  if (!representation) return new Response('Introuvable', { status: 404 })

  const [unitPriceCents, bookings] = await Promise.all([
    getTicketPriceCents(prisma),
    prisma.booking.findMany({
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
        payments: {
          orderBy: { createdAt: 'asc' },
          select: { method: true, amountCents: true, depositOn: true, reference: true },
        },
      },
    }),
  ])

  const lignes = [
    [
      'Nom',
      'Email',
      'Téléphone',
      'Statut',
      'Places',
      'Places offertes',
      'Montant dû',
      'Payé le',
      'Reçu',
      'Reste',
      'Soldé',
      'Versements',
      'Remboursé',
      'Net',
      'Place(s) attribuée(s)',
      'Scanné',
      'Note interne',
    ],
  ]
  for (const b of bookings) {
    const places = b.tickets
      .map((t) => `${capitaliser(t.seat.row.section.name)} ${t.seat.row.label} ${t.seat.number}`)
      .join(' / ')
    const scannes = b.tickets.filter((t) => t.scannedAt !== null).length
    const r = resumePaiement({
      partySize: b.partySize,
      freeSeats: b.freeSeats,
      unitPriceCents,
      payments: b.payments,
      refundCents: b.refundCents,
    })
    // Montant dû / reste / soldé n'ont de sens que pour une demande active : une
    // demande annulée/expirée n'est plus due (sinon « Reste » se lit comme une
    // créance à recouvrer dans la feuille de caisse).
    const actif = ['pending', 'paid', 'placed'].includes(b.status)
    // Détail des versements : « chèque 20,00 (dépôt 15/07/2026, n°123) ; … ».
    const versements = b.payments
      .map((p) => {
        const meta = [
          p.depositOn ? `dépôt ${jourCourt.format(p.depositOn)}` : null,
          p.reference || null,
        ].filter(Boolean)
        return `${METHODES[p.method] ?? p.method} ${montantCsv(p.amountCents)}${meta.length ? ` (${meta.join(', ')})` : ''}`
      })
      .join(' ; ')
    lignes.push([
      b.name,
      b.email,
      formatFrPhone(b.phone),
      STATUTS[b.status] ?? b.status,
      String(b.partySize),
      b.freeSeats > 0 ? String(b.freeSeats) : '',
      actif ? montantCsv(r.duCents) : '',
      b.paidAt ? dateCourte.format(b.paidAt) : '',
      montantCsv(r.remisCents),
      actif && r.resteCents != null ? montantCsv(r.resteCents) : '',
      actif ? (r.soldee == null ? '' : r.soldee ? 'Oui' : 'Non') : '',
      versements,
      r.rembourseCents > 0 ? montantCsv(r.rembourseCents) : '',
      montantCsv(r.netCents),
      places,
      b.tickets.length > 0 ? `${scannes}/${b.tickets.length}` : '',
      b.adminNotes ?? '',
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
