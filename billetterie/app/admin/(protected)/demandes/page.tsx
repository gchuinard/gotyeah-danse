// /admin/demandes — la liste des demandes, le quotidien des bénévoles.
//
// Server component : filtres par représentation / statut / nom via
// searchParams (asynchrones en Next 16, GET, aucune mutation), tri
// createdAt desc. Le statut « expirée » est AFFICHÉ dès que la date est
// passée (status=pending mais expiresAt < maintenant), sans attendre le cron.

import type { Prisma } from '@prisma/client'
import type { Metadata } from 'next'
import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

import {
  annoterAction,
  annulerAction,
  marquerPayeeAction,
  prolongerAction,
  rectifierPlacesAction,
  renvoyerBilletsAction,
} from './actions'
import { ConfirmSubmit } from './confirm-submit'
import styles from './demandes.module.css'

export const metadata: Metadata = { title: 'Demandes — Billetterie admin' }

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

const dateCourte = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
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
  paid: 'Payée',
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

  const where: Prisma.BookingWhereInput = {
    ...(statut === 'expiree'
      ? { status: 'pending', expiresAt: { lte: now } }
      : statut
        ? { status: statut }
        : {}),
    ...(q ? { name: { contains: q } } : {}),
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

      <form method="GET" action="/admin/demandes" className={styles.filtres}>
        <label>
          Statut
          <select name="statut" defaultValue={statut}>
            <option value="">Tous</option>
            <option value="pending">En attente</option>
            <option value="expiree">Expirées</option>
            <option value="paid">Payées</option>
            <option value="placed">Placées</option>
            <option value="cancelled">Annulées</option>
          </select>
        </label>
        <label>
          Nom
          <input type="search" name="q" defaultValue={q} placeholder="Rechercher un nom…" />
        </label>
        <button type="submit">Filtrer</button>
        {(statut || q) && <Link href="/admin/demandes">Réinitialiser</Link>}
      </form>

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
                return (
                  <tr key={d.id}>
                    <td>
                      <span className={styles.nom}>{d.name}</span>
                      {d.notes && <span className={styles.notes}>{d.notes}</span>}
                      {d.adminNotes && <span className={styles.adminNotes}>📝 {d.adminNotes}</span>}
                      <details className={styles.annoter}>
                        <summary>{d.adminNotes ? 'Modifier la note' : 'Ajouter une note'}</summary>
                        <form action={annoterAction} className={styles.annoterForm}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="retour" value={retour.toString()} />
                          <input
                            type="text"
                            name="annotation"
                            maxLength={300}
                            defaultValue={d.adminNotes ?? ''}
                            placeholder="chèque n°…, PMR, contexte…"
                          />
                          <button type="submit" className={styles.btn}>
                            OK
                          </button>
                        </form>
                      </details>
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
                          </>
                        )}
                        {d.status === 'paid' && (
                          <Link className={styles.btnLien} href={`/admin/placement/${d.id}`}>
                            Placer
                          </Link>
                        )}
                        {d.status === 'placed' && (
                          <>
                            <Link className={styles.btnLien} href={`/admin/placement/${d.id}?mode=deplacer`}>
                              Déplacer
                            </Link>
                            <form action={renvoyerBilletsAction}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="retour" value={retour.toString()} />
                              <button type="submit" className={styles.btn}>
                                Renvoyer les billets
                              </button>
                            </form>
                          </>
                        )}
                        {['pending', 'paid', 'placed'].includes(d.status) && (
                          <form action={rectifierPlacesAction} className={styles.rectif}>
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="retour" value={retour.toString()} />
                            <input
                              type="number"
                              name="places"
                              min={1}
                              max={8}
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
