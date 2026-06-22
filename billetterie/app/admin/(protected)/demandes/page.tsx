// /admin/demandes — la liste des demandes, le quotidien des bénévoles.
//
// Server component : filtres par représentation / statut / nom via
// searchParams (asynchrones en Next 16, GET, aucune mutation), tri
// createdAt desc. Le statut « expirée » est AFFICHÉ dès que la date est
// passée (status=pending mais expiresAt < maintenant), sans attendre le cron.

import type { Prisma } from '@prisma/client'
import type { Metadata } from 'next'
import Link from 'next/link'

import { ACTION_LABELS } from '@/lib/admin/events'
import { euros, resumePaiement, type ResumePaiement } from '@/lib/admin/money'
import { getTicketPriceCents } from '@/lib/admin/pricing'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { formatFrPhone } from '@/lib/public/phone'

import { DemandeRow, type DemandeDetail } from './demande-row'
import { FiltresDemandes } from './filtres-demandes'
import styles from './demandes.module.css'

export const metadata: Metadata = { title: 'Demandes — Billetterie admin' }

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

const dateCourte = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

// Pour l'historique : date + heure (Paris).
const dateHeureCourte = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function premier(valeur: string | string[] | undefined): string {
  return (Array.isArray(valeur) ? valeur[0] : valeur) ?? ''
}

function capitaliser(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}

// « Centre G 1-4 » : groupe par section + rangée, compresse les numéros consécutifs.
function placesAttribuees(
  tickets: Array<{ seat: { number: number; row: { label: string; section: { name: string } } } }>,
): string {
  const groupes = new Map<string, number[]>()
  for (const t of tickets) {
    const cle = `${capitaliser(t.seat.row.section.name)} ${t.seat.row.label}`
    groupes.set(cle, [...(groupes.get(cle) ?? []), t.seat.number])
  }
  const parties: string[] = []
  for (const [cle, numeros] of groupes) {
    numeros.sort((a, b) => a - b)
    const plages: string[] = []
    let debut = numeros[0]
    let fin = numeros[0]
    for (const n of numeros.slice(1)) {
      if (n === fin + 1) fin = n
      else {
        plages.push(debut === fin ? `${debut}` : `${debut}-${fin}`)
        debut = fin = n
      }
    }
    plages.push(debut === fin ? `${debut}` : `${debut}-${fin}`)
    parties.push(`${cle} ${plages.join(', ')}`)
  }
  return parties.join(' · ')
}

const LIBELLES: Record<string, string> = {
  pending: 'En attente',
  paid: 'À placer',
  placed: 'Placée',
  cancelled: 'Annulée',
  expired: 'Expirée',
}

const CLASSES_BADGE: Record<string, string> = {
  pending: 'badgePending',
  paid: 'badgePaid',
  placed: 'badgePlaced',
  cancelled: 'badgeCancelled',
  expired: 'badgeExpired',
}

// Statut de paiement (chip sous le statut de la demande), calculé depuis le
// résumé des versements vs le montant dû — lib/admin/money fait foi.
function statutPaiement(
  r: ResumePaiement,
  aPaidAt: boolean,
): { label: string; cls: 'payOui' | 'payNon' | 'payRembourse' | 'payAcompte'; title: string } {
  if (r.rembourseCents > 0) {
    return {
      label: '↩ Remboursé',
      cls: 'payRembourse',
      title: `Reçu ${euros(r.remisCents)}, remboursé ${euros(r.rembourseCents)} → net ${euros(r.netCents)}${r.duCents != null ? ` / dû ${euros(r.duCents)}` : ''}`,
    }
  }
  if (r.remisCents === 0) {
    return aPaidAt
      ? { label: '✓ Payé', cls: 'payOui', title: 'Réglé (montant non saisi)' }
      : { label: '✗ Non payé', cls: 'payNon', title: 'Pas encore réglé' }
  }
  if (r.duCents == null) {
    return { label: '✓ Payé', cls: 'payOui', title: `Réglé ${euros(r.remisCents)}` }
  }
  if (r.tropPercuCents > 0) {
    return {
      label: '⚠ Trop-perçu',
      cls: 'payAcompte',
      title: `Reçu ${euros(r.netCents)} / dû ${euros(r.duCents)} — trop-perçu ${euros(r.tropPercuCents)}`,
    }
  }
  if (r.soldee) {
    return { label: '✓ Soldé', cls: 'payOui', title: `Soldé — ${euros(r.netCents)}` }
  }
  return {
    label: '⏳ Acompte',
    cls: 'payAcompte',
    title: `Reçu ${euros(r.netCents)} / dû ${euros(r.duCents)} — reste ${euros(r.resteCents ?? 0)}`,
  }
}

export default async function DemandesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin()

  const params = await searchParams
  const statut = premier(params.statut)
  const paiement = premier(params.paiement) // '' | 'paye' | 'impaye'
  const q = premier(params.q).trim()
  const ok = premier(params.ok)
  const err = premier(params.err)
  const now = new Date()

  // Filtres re-sérialisés (liste blanche) : passés aux actions pour revenir
  // sur la même vue après une mutation.
  const retour = new URLSearchParams()
  if (statut) retour.set('statut', statut)
  if (paiement) retour.set('paiement', paiement)
  if (q) retour.set('q', q)
  // Filtre courant à reconduire après un placement (lien → écran → retour).
  const retourQs = retour.toString()
  const avecRetour = (base: string) =>
    retourQs ? `${base}${base.includes('?') ? '&' : '?'}retour=${encodeURIComponent(retourQs)}` : base

  // Recherche sur nom / email / téléphone. Les numéros sont stockés tantôt
  // formatés ("06 14 48 28 90"), tantôt en chiffres bruts : on teste les DEUX
  // formes de la partie chiffres de la recherche → insensible aux espaces.
  const phoneDigits = q.replace(/\D/g, '')
  const rechercheOR: Prisma.BookingWhereInput[] = q
    ? [
        { name: { contains: q } },
        { email: { contains: q } },
        ...(phoneDigits
          ? [
              { phone: { contains: phoneDigits } },
              { phone: { contains: formatFrPhone(phoneDigits) } },
            ]
          : [{ phone: { contains: q } }]),
      ]
    : []

  const where: Prisma.BookingWhereInput = {
    ...(statut === 'expiree'
      ? { status: 'pending', expiresAt: { lte: now } }
      : statut
        ? { status: statut }
        : {}),
    // Filtre paiement : « payées » = un règlement existe (paidAt posé) ;
    // « non payées » = aucun règlement. Sur la colonne paidAt (indexable).
    ...(paiement === 'paye'
      ? { paidAt: { not: null } }
      : paiement === 'impaye'
        ? { paidAt: null }
        : {}),
    ...(rechercheOR.length ? { OR: rechercheOR } : {}),
  }

  // Une seule représentation par an : sert juste de cible à l'export CSV.
  const [representation, unitPriceCents, demandes] = await Promise.all([
    prisma.representation.findFirst({ orderBy: { startsAt: 'asc' }, select: { id: true } }),
    getTicketPriceCents(prisma),
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        tickets: {
          select: {
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
          select: { id: true, method: true, amountCents: true, depositOn: true, reference: true },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, action: true, detail: true, adminEmail: true, createdAt: true },
        },
      },
    }),
  ])

  return (
    <main className={styles.page}>
      <div className={styles.titre}>
        <h1>Demandes</h1>
        <div className={styles.titreActions}>
          <Link className={styles.btnLien} href="/admin/demandes/nouvelle">
            + Nouvelle demande
          </Link>
          {representation && (
            <a className={styles.export} href={`/api/admin/export/${representation.id}`}>
              Exporter en CSV
            </a>
          )}
        </div>
      </div>

      {ok && <p className={styles.bannerOk}>{ok}</p>}
      {err && <p className={styles.bannerErr}>{err}</p>}

      <FiltresDemandes statut={statut} q={q} paiement={paiement} />

      {demandes.length === 0 ? (
        <p className={styles.vide}>Aucune demande ne correspond à ces critères.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Contact</th>
                <th>Places</th>
                <th>Statut</th>
                <th>Créée le</th>
                <th>Payée le</th>
                <th>Places attribuées</th>
                <th>Échéance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {demandes.map((d) => {
                const expiree = d.status === 'pending' && d.expiresAt !== null && d.expiresAt <= now
                const affichage = expiree ? 'expired' : d.status
                // Rappel popup : les places ont-elles changé APRÈS le paiement ?
                let placesChangedAfterPayment = false
                if (d.paidAt) {
                  const paidMs = d.paidAt.getTime()
                  placesChangedAfterPayment = d.events.some(
                    (e) => e.action === 'party_changed' && e.createdAt.getTime() > paidMs,
                  )
                }
                const resume = resumePaiement({
                  partySize: d.partySize,
                  freeSeats: d.freeSeats,
                  unitPriceCents,
                  payments: d.payments,
                  refundCents: d.refundCents,
                })
                const paiement = statutPaiement(resume, d.paidAt != null)
                const detail: DemandeDetail = {
                  id: d.id,
                  name: d.name,
                  email: d.email,
                  phone: d.phone,
                  partySize: d.partySize,
                  freeSeats: d.freeSeats,
                  unitPriceCents,
                  status: d.status,
                  statutLabel: LIBELLES[affichage] ?? d.status,
                  expiree,
                  paid: d.paidAt != null,
                  pmrCount: d.pmrCount,
                  pmrCompanions: d.pmrCompanions,
                  ticketMode: d.ticketMode,
                  publicToken: d.publicToken,
                  payments: d.payments.map((p) => ({
                    id: p.id,
                    method: p.method,
                    amountCents: p.amountCents,
                    depositOnText: p.depositOn ? dateCourte.format(p.depositOn) : null,
                    reference: p.reference,
                  })),
                  refundCents: d.refundCents,
                  refundReason: d.refundReason,
                  placesChangedAfterPayment,
                  notes: d.notes,
                  adminNotes: d.adminNotes,
                  places:
                    d.status === 'placed' && d.tickets.length > 0 ? placesAttribuees(d.tickets) : null,
                  createdAt: dateHeureCourte.format(d.createdAt),
                  paidAt: d.paidAt ? dateHeureCourte.format(d.paidAt) : null,
                  placedAt: d.placedAt ? dateHeureCourte.format(d.placedAt) : null,
                  expiresAt: d.expiresAt ? dateHeureCourte.format(d.expiresAt) : null,
                  retour: retour.toString(),
                  events: d.events.map((e) => ({
                    id: e.id,
                    label: ACTION_LABELS[e.action] ?? e.action,
                    detail: e.detail,
                    adminEmail: e.adminEmail,
                    date: dateHeureCourte.format(e.createdAt),
                  })),
                }
                return (
                  <DemandeRow key={d.id} detail={detail}>
                    <td>
                      <span className={styles.nom}>
                        {d.name}
                        {d.pmrCount > 0 && (
                          <span
                            className={styles.pmrTag}
                            title={
                              `${d.pmrCount} personne(s) PMR` +
                              (d.pmrCompanions > 0
                                ? ` — ${d.pmrCompanions} place(s) accompagnant à coller`
                                : ' — sans accompagnant à coller')
                            }
                          >
                            ♿ PMR{d.pmrCount > 1 ? ` ×${d.pmrCount}` : ''}
                          </span>
                        )}
                        {d.ticketMode === 'papier' && (
                          <span
                            className={styles.remiseTag}
                            title="Billets remis en papier (à imprimer) — pas d'email"
                          >
                            🖨️ Papier
                          </span>
                        )}
                      </span>
                      <span className={styles.indics}>
                        {d.adminNotes && <span title="Note interne présente">📝</span>}
                        {d.notes && <span title="Demande particulière de la famille">💬</span>}
                        <span className={styles.histoCount} title="Actions enregistrées">
                          🕘 {d.events.length}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className={styles.contact}>{d.email}</span>
                      <span className={styles.contact}>{d.phone}</span>
                    </td>
                    <td className={styles.nombre}>{d.partySize}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[CLASSES_BADGE[affichage] ?? 'badgeCancelled']}`}>
                        {LIBELLES[affichage] ?? d.status}
                      </span>
                      {['pending', 'paid', 'placed'].includes(d.status) && (
                        <span
                          className={`${styles.payChip} ${styles[paiement.cls]}`}
                          title={paiement.title}
                        >
                          {paiement.label}
                        </span>
                      )}
                    </td>
                    <td>{dateCourte.format(d.createdAt)}</td>
                    <td>{d.paidAt ? dateCourte.format(d.paidAt) : '—'}</td>
                    <td>{d.status === 'placed' && d.tickets.length > 0 ? placesAttribuees(d.tickets) : '—'}</td>
                    <td>{d.status === 'pending' && d.expiresAt ? dateCourte.format(d.expiresAt) : '—'}</td>
                    <td>
                      <div className={styles.actions}>
                        {(d.status === 'pending' || d.status === 'paid') && !expiree && (
                          <Link
                            className={styles.btnLien}
                            href={avecRetour(`/admin/placement/${d.id}`)}
                          >
                            Placer
                          </Link>
                        )}
                        {d.status === 'placed' && (
                          <Link
                            className={styles.btnLien}
                            href={avecRetour(`/admin/placement/${d.id}?mode=deplacer`)}
                          >
                            Déplacer
                          </Link>
                        )}
                      </div>
                    </td>
                  </DemandeRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
