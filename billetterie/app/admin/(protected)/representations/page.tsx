// Gestion des représentations : liste, création, ouverture/fermeture des
// réservations, archivage (clôture réversible) et suppression (bloquée dès
// qu'une demande existe — l'archivage est la réponse à « je veux la sortir de
// mes écrans sans rien perdre »).

import type { Metadata } from 'next'
import Link from 'next/link'

import { demandesVivantesParRepresentation } from '@/lib/admin/archive'
import { euros } from '@/lib/admin/money'
import { getTicketPrices } from '@/lib/admin/pricing'
import { requireSuperAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { ConfirmSubmit } from '../demandes/confirm-submit'
import {
  archiverRepresentation,
  basculerOuverture,
  creerRepresentation,
  definirPrixAction,
  desarchiverRepresentation,
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

// Date courte pour l'infobulle « archivée le … par … ».
const dateCourteFr = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

// Message de confirmation de l'archivage : on CHIFFRE l'impact (ce qui va être
// gelé) avant de cliquer, puisque rien n'est muté et que tout est réversible.
function messageArchivage(titre: string, demandes: number, vivantes: number): string {
  const impact =
    demandes === 0
      ? 'Elle n’a aucune demande.'
      : `Ses ${demandes} demande(s) sortiront de la liste et seront gelées${
          vivantes > 0 ? `, dont ${vivantes} encore en cours (en attente / à placer / placée)` : ''
        }.`
  return `Archiver « ${titre} » ? ${impact} Rien n’est supprimé : stats, historique et export CSV restent disponibles, et tu peux la désarchiver à tout moment.`
}

export default async function RepresentationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams
  const ok = premier(params.ok)
  const err = premier(params.err)

  const [repsBrutes, prices, vivantes] = await Promise.all([
    prisma.representation.findMany({
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { bookings: true, tickets: true } } },
    }),
    getTicketPrices(prisma),
    demandesVivantesParRepresentation(prisma),
  ])
  // Les archivées passent en bas de tableau (et en style estompé) : elles
  // restent visibles — c'est ici qu'on les rouvre et qu'on les exporte.
  const archivees = repsBrutes.filter((r) => r.archivedAt !== null)
  const reps = [...repsBrutes.filter((r) => r.archivedAt === null), ...archivees]
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
          {reps.map((rep) => {
            const archiveeLe = rep.archivedAt
            return (
              <tr key={rep.id} className={archiveeLe ? styles.rowArchivee : undefined}>
                <td className={styles.repTitle}>{rep.title}</td>
                <td>{dateFr.format(rep.startsAt)}</td>
                <td>
                  {archiveeLe ? (
                    <span
                      className={styles.badgeArchived}
                      title={`Archivée le ${dateCourteFr.format(archiveeLe)}${
                        rep.archivedBy ? ` par ${rep.archivedBy}` : ''
                      }`}
                    >
                      Archivée
                    </span>
                  ) : (
                    <span className={rep.isOpen ? styles.badgeOpen : styles.badgeClosed}>
                      {rep.isOpen ? 'Ouvertes' : 'Fermées'}
                    </span>
                  )}
                </td>
                <td>{rep._count.bookings}</td>
                <td>{rep._count.tickets}</td>
                <td className={styles.actions}>
                  {archiveeLe ? (
                    <form action={desarchiverRepresentation}>
                      <input type="hidden" name="id" value={rep.id} />
                      <button type="submit" className={styles.btn}>
                        Désarchiver
                      </button>
                    </form>
                  ) : (
                    <>
                      <form action={basculerOuverture}>
                        <input type="hidden" name="id" value={rep.id} />
                        <button type="submit" className={styles.btn}>
                          {rep.isOpen ? 'Fermer' : 'Ouvrir'}
                        </button>
                      </form>
                      <Link className={styles.btn} href={`/admin/representations/${rep.id}`}>
                        Modifier
                      </Link>
                      <form action={archiverRepresentation}>
                        <input type="hidden" name="id" value={rep.id} />
                        <ConfirmSubmit
                          className={styles.btn}
                          message={messageArchivage(
                            rep.title,
                            rep._count.bookings,
                            vivantes.get(rep.id) ?? 0,
                          )}
                        >
                          Archiver
                        </ConfirmSubmit>
                      </form>
                    </>
                  )}
                  {/* Export accessible même archivée : c'est la raison d'être de
                      l'archive (le tableau de bord, lui, ne la liste plus). */}
                  <a className={styles.btn} href={`/api/admin/export/${rep.id}`}>
                    Export CSV
                  </a>
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
                      title="Une représentation avec des demandes ne peut pas être supprimée — archive-la plutôt (réversible, rien n'est perdu)."
                    >
                      suppression bloquée
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
          {reps.length === 0 && (
            <tr>
              <td colSpan={6} className={styles.empty}>
                Aucune représentation — crée la première ci-dessous.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className={styles.hint}>
        <strong>Archiver</strong>{' '}= clôturer une représentation passée : ses demandes quittent la
        liste des demandes, le tableau de bord et les sélecteurs plan / scan, et deviennent{' '}
        <strong>gelées</strong>{' '}(plus aucune action possible). Rien n&rsquo;est supprimé —
        statistiques, historique et export CSV restent disponibles, et un clic sur{' '}
        <strong>Désarchiver</strong>{' '}remet tout comme avant (réservations fermées).
        {archivees.length > 0 && (
          <>
            {' '}
            Les demandes archivées se consultent en lecture seule depuis{' '}
            <Link href="/admin/demandes?archives=1">la liste des demandes</Link>.
          </>
        )}
      </p>

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
