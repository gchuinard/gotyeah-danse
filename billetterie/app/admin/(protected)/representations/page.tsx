// Gestion des représentations : liste, création, ouverture/fermeture des
// réservations, suppression (bloquée dès qu'une demande existe).

import type { Metadata } from 'next'
import Link from 'next/link'

import { euros } from '@/lib/admin/money'
import { getTicketPrices } from '@/lib/admin/pricing'
import { requireSuperAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { ConfirmSubmit } from '../demandes/confirm-submit'
import {
  basculerOuverture,
  creerRepresentation,
  definirPrixAction,
  supprimerRepresentation,
} from './actions'
import styles from './representations.module.css'

export const metadata: Metadata = { title: 'Représentations — Admin' }
export const dynamic = 'force-dynamic'

const dateFr = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function RepresentationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams
  const ok = premier(params.ok)
  const err = premier(params.err)

  const [reps, prices] = await Promise.all([
    prisma.representation.findMany({
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { bookings: true, tickets: true } } },
    }),
    getTicketPrices(prisma),
  ])
  const enEuros = (c: number | null) => (c != null ? (c / 100).toFixed(2).replace('.', ',') : '')
  const prixAdulteEuros = enEuros(prices.adultCents)
  const prixEnfantEuros = enEuros(prices.childCents)

  return (
    <main>
      <h1 className={styles.title}>Représentations</h1>

      {ok && <p className={styles.bannerOk}>{ok}</p>}
      {err && <p className={styles.bannerErr}>{err}</p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Représentation</th>
            <th>Date</th>
            <th>Réservations</th>
            <th>Demandes</th>
            <th>Billets</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reps.map((rep) => (
            <tr key={rep.id}>
              <td className={styles.repTitle}>{rep.title}</td>
              <td>{dateFr.format(rep.startsAt)}</td>
              <td>
                <span className={rep.isOpen ? styles.badgeOpen : styles.badgeClosed}>
                  {rep.isOpen ? 'Ouvertes' : 'Fermées'}
                </span>
              </td>
              <td>{rep._count.bookings}</td>
              <td>{rep._count.tickets}</td>
              <td className={styles.actions}>
                <form action={basculerOuverture}>
                  <input type="hidden" name="id" value={rep.id} />
                  <button type="submit" className={styles.btn}>
                    {rep.isOpen ? 'Fermer' : 'Ouvrir'}
                  </button>
                </form>
                <Link className={styles.btn} href={`/admin/representations/${rep.id}`}>
                  Modifier
                </Link>
                {rep._count.bookings === 0 ? (
                  <form action={supprimerRepresentation}>
                    <input type="hidden" name="id" value={rep.id} />
                    <ConfirmSubmit
                      className={`${styles.btn} ${styles.btnDanger}`}
                      message={`Supprimer « ${rep.title} » ? Cette action est définitive.`}
                    >
                      Supprimer
                    </ConfirmSubmit>
                  </form>
                ) : (
                  <span
                    className={styles.deleteHint}
                    title="Une représentation avec des demandes ne peut pas être supprimée — ferme plutôt les réservations."
                  >
                    suppression bloquée
                  </span>
                )}
              </td>
            </tr>
          ))}
          {reps.length === 0 && (
            <tr>
              <td colSpan={6} className={styles.empty}>
                Aucune représentation — crée la première ci-dessous.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className={styles.createCard}>
        <h2 className={styles.subtitle}>Tarifs</h2>
        <p className={styles.hint}>
          {prices.adultCents != null || prices.childCents != null ? (
            <>
              Tarifs actuels :{' '}
              <strong>{prices.adultCents != null ? `adulte ${euros(prices.adultCents)}` : 'adulte —'}</strong>
              {' · '}
              <strong>{prices.childCents != null ? `enfant ${euros(prices.childCents)}` : 'enfant —'}</strong>
              . Montant dû d&apos;une demande = adultes × tarif adulte + enfants × tarif enfant
              (places offertes déduites des enfants d&apos;abord).
            </>
          ) : (
            <>
              Aucun tarif défini : les montants dus ne sont pas calculés (saisie libre des
              versements). Fixe les tarifs avant les ventes.
            </>
          )}
        </p>
        <form action={definirPrixAction} className={styles.createForm}>
          <label className={styles.field}>
            Tarif adulte (en euros)
            <input
              className={styles.input}
              type="text"
              name="prixAdulte"
              inputMode="decimal"
              placeholder="ex. 12"
              defaultValue={prixAdulteEuros}
              aria-label="Tarif adulte en euros"
            />
          </label>
          <label className={styles.field}>
            Tarif enfant (en euros)
            <input
              className={styles.input}
              type="text"
              name="prixEnfant"
              inputMode="decimal"
              placeholder="ex. 6"
              defaultValue={prixEnfantEuros}
              aria-label="Tarif enfant en euros"
            />
          </label>
          <button type="submit" className={styles.btnPrimary}>
            Enregistrer les tarifs
          </button>
        </form>
        <p className={styles.hint}>
          Laisse un champ vide puis enregistre pour effacer ce tarif. Les tarifs s’appliquent à
          toutes les représentations.
        </p>
      </section>

      <section className={styles.createCard}>
        <h2 className={styles.subtitle}>Nouvelle représentation</h2>
        <form action={creerRepresentation} className={styles.createForm}>
          <label className={styles.field}>
            Titre
            <input
              className={styles.input}
              type="text"
              name="title"
              placeholder="Samedi 20h30"
              minLength={2}
              maxLength={100}
              required
            />
          </label>
          <label className={styles.field}>
            Date et heure (heure de Paris)
            <input className={styles.input} type="datetime-local" name="startsAt" required />
          </label>
          <button type="submit" className={styles.btnPrimary}>
            Créer (réservations fermées)
          </button>
        </form>
        <p className={styles.hint}>
          La représentation est créée <strong>fermée</strong>{' '}: elle n&rsquo;apparaît sur le
          formulaire public qu&rsquo;une fois les réservations ouvertes.
        </p>
      </section>
    </main>
  )
}
