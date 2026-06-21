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
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { MAX_PARTY_SIZE } from '@/lib/public/limits'
import { formatFrPhone } from '@/lib/public/phone'

import {
  annulerAction,
  annulerPaiementAction,
  basculerRemiseAction,
  marquerPayeeAction,
  prolongerAction,
  rectifierPlacesAction,
  renvoyerBilletsAction,
} from './actions'
import { ConfirmSubmit } from './confirm-submit'
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

const METHODES: Record<string, string> = { especes: 'Espèces', cheque: 'Chèque', autre: 'Autre' }

// Règlement formaté pour la popup de détail (« Chèque · 25,00 € »).
function formatReglement(paidAt: Date | null, methode: string | null, montant: number | null): string | null {
  if (!paidAt) return null
  return (
    [
      methode ? (METHODES[methode] ?? methode) : null,
      montant != null ? `${(montant / 100).toFixed(2).replace('.', ',')} €` : null,
    ]
      .filter(Boolean)
      .join(' · ') || null
  )
}

export default async function DemandesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin()

  const params = await searchParams
  const statut = premier(params.statut)
  const q = premier(params.q).trim()
  const ok = premier(params.ok)
  const err = premier(params.err)
  const now = new Date()

  // Filtres re-sérialisés (liste blanche) : passés aux actions pour revenir
  // sur la même vue après une mutation.
  const retour = new URLSearchParams()
  if (statut) retour.set('statut', statut)
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
    ...(rechercheOR.length ? { OR: rechercheOR } : {}),
  }

  // Une seule représentation par an : sert juste de cible à l'export CSV.
  const [representation, demandes] = await Promise.all([
    prisma.representation.findFirst({ orderBy: { startsAt: 'asc' }, select: { id: true } }),
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

      <FiltresDemandes statut={statut} q={q} />

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
                const detail: DemandeDetail = {
                  id: d.id,
                  name: d.name,
                  email: d.email,
                  phone: d.phone,
                  partySize: d.partySize,
                  statutLabel: LIBELLES[affichage] ?? d.status,
                  pmrCount: d.pmrCount,
                  pmrCompanions: d.pmrCompanions,
                  ticketMode: d.ticketMode,
                  notes: d.notes,
                  adminNotes: d.adminNotes,
                  places:
                    d.status === 'placed' && d.tickets.length > 0 ? placesAttribuees(d.tickets) : null,
                  reglement: formatReglement(d.paidAt, d.paymentMethod, d.amountCents),
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
                      {d.status === 'placed' && !d.paidAt && (
                        <span className={styles.nonRegle} title="Placé mais pas encore réglé">
                          ⚠ non réglé
                        </span>
                      )}
                    </td>
                    <td>{dateCourte.format(d.createdAt)}</td>
                    <td>{d.paidAt ? dateCourte.format(d.paidAt) : '—'}</td>
                    <td>{d.status === 'placed' && d.tickets.length > 0 ? placesAttribuees(d.tickets) : '—'}</td>
                    <td>{d.status === 'pending' && d.expiresAt ? dateCourte.format(d.expiresAt) : '—'}</td>
                    <td>
                      <div className={styles.actions}>
                        {d.status === 'pending' && (
                          <>
                            <form action={marquerPayeeAction} className={styles.payerForm}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="retour" value={retour.toString()} />
                              <div className={styles.payerChamps}>
                                <select name="methode" aria-label="Mode de règlement" defaultValue="cheque">
                                  <option value="cheque">Chèque</option>
                                  <option value="especes">Espèces</option>
                                  <option value="autre">Autre</option>
                                </select>
                                <input
                                  type="text"
                                  name="montant"
                                  inputMode="decimal"
                                  placeholder="€"
                                  aria-label="Montant encaissé en euros"
                                  className={styles.montantInput}
                                />
                              </div>
                              <button type="submit" className={styles.btn}>
                                Marquer payée
                              </button>
                            </form>
                            <form action={prolongerAction}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="retour" value={retour.toString()} />
                              <button type="submit" className={styles.btn}>
                                Prolonger (+14 j)
                              </button>
                            </form>
                            {!expiree && (
                              <Link
                                className={styles.btnLien}
                                href={avecRetour(`/admin/placement/${d.id}`)}
                                title="Placer maintenant, sans attendre le paiement"
                              >
                                Placer
                              </Link>
                            )}
                          </>
                        )}
                        {d.status === 'paid' && (
                          <>
                            <Link className={styles.btnLien} href={avecRetour(`/admin/placement/${d.id}`)}>
                              Placer
                            </Link>
                            <form action={annulerPaiementAction}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="retour" value={retour.toString()} />
                              <ConfirmSubmit
                                className={styles.btn}
                                message={`Annuler le règlement de ${d.name} ? La demande repassera en attente de paiement.`}
                              >
                                Annuler le règlement
                              </ConfirmSubmit>
                            </form>
                          </>
                        )}
                        {d.status === 'placed' && (
                          <>
                            {!d.paidAt && (
                              <form action={marquerPayeeAction} className={styles.payerForm}>
                                <input type="hidden" name="id" value={d.id} />
                                <input type="hidden" name="retour" value={retour.toString()} />
                                <div className={styles.payerChamps}>
                                  <select name="methode" aria-label="Mode de règlement" defaultValue="cheque">
                                    <option value="cheque">Chèque</option>
                                    <option value="especes">Espèces</option>
                                    <option value="autre">Autre</option>
                                  </select>
                                  <input
                                    type="text"
                                    name="montant"
                                    inputMode="decimal"
                                    placeholder="€"
                                    aria-label="Montant encaissé en euros"
                                    className={styles.montantInput}
                                  />
                                </div>
                                <button type="submit" className={styles.btn}>
                                  Marquer payée
                                </button>
                              </form>
                            )}
                            {d.paidAt && (
                              <form action={annulerPaiementAction}>
                                <input type="hidden" name="id" value={d.id} />
                                <input type="hidden" name="retour" value={retour.toString()} />
                                <ConfirmSubmit
                                  className={styles.btn}
                                  message={`Annuler le règlement de ${d.name} ? La demande restera placée mais non réglée.`}
                                >
                                  Annuler le règlement
                                </ConfirmSubmit>
                              </form>
                            )}
                            <Link
                              className={styles.btnLien}
                              href={avecRetour(`/admin/placement/${d.id}?mode=deplacer`)}
                            >
                              Déplacer
                            </Link>
                            {d.ticketMode === 'papier' ? (
                              <Link
                                className={styles.btnLien}
                                href={`/billets/${d.publicToken}`}
                                target="_blank"
                                rel="noopener"
                                title="Ouvre la page imprimable des billets (avec QR)"
                              >
                                Imprimer les billets ↗
                              </Link>
                            ) : (
                              <form action={renvoyerBilletsAction}>
                                <input type="hidden" name="id" value={d.id} />
                                <input type="hidden" name="retour" value={retour.toString()} />
                                {d.paidAt ? (
                                  <button type="submit" className={styles.btn}>
                                    Renvoyer les billets
                                  </button>
                                ) : (
                                  <ConfirmSubmit
                                    className={styles.btn}
                                    message={`Aucun paiement n'est enregistré pour la demande de ${d.name}. Envoyer quand même les billets et le QR à la famille ?`}
                                  >
                                    Envoyer les billets
                                  </ConfirmSubmit>
                                )}
                              </form>
                            )}
                          </>
                        )}
                        {['pending', 'paid', 'placed'].includes(d.status) && (
                          <form action={basculerRemiseAction}>
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="retour" value={retour.toString()} />
                            <button
                              type="submit"
                              className={styles.btn}
                              title="Choisir comment remettre les billets : e-billet (email) ou papier (impression)"
                            >
                              {d.ticketMode === 'papier' ? '📧 Passer en e-billet' : '🖨️ Passer en papier'}
                            </button>
                          </form>
                        )}
                        {['pending', 'paid', 'placed'].includes(d.status) && (
                          <form action={rectifierPlacesAction} className={styles.rectif}>
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="retour" value={retour.toString()} />
                            <input
                              type="number"
                              name="places"
                              min={1}
                              max={MAX_PARTY_SIZE}
                              defaultValue={d.partySize}
                              aria-label="Nombre de places"
                              className={styles.rectifInput}
                            />
                            <button type="submit" className={styles.btn}>
                              Rectifier
                            </button>
                          </form>
                        )}
                        {['pending', 'paid', 'placed'].includes(d.status) && (
                          <form action={annulerAction}>
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="retour" value={retour.toString()} />
                            <ConfirmSubmit
                              className={styles.btnDanger}
                              message={`Annuler la demande de ${d.name} (${d.partySize} place(s)) ? Les billets éventuels seront invalidés.`}
                            >
                              Annuler
                            </ConfirmSubmit>
                          </form>
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
