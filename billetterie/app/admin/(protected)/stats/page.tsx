// /admin/stats — mini-statistiques par représentation + réconciliation de
// caisse. Tout est calculé à la volée (pas de table dédiée) : remplissage,
// répartition des tailles de groupes, no-shows, et totaux encaissés par mode
// de règlement (saisis au « marquer payée »).

import type { Metadata } from 'next'
import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

import styles from './stats.module.css'

export const metadata: Metadata = { title: 'Statistiques — Billetterie admin' }

const dateHeureFr = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
})

const METHODE_LABELS: Record<string, string> = {
  especes: 'Espèces',
  cheque: 'Chèques',
  autre: 'Autre',
  inconnu: 'Non renseigné',
}

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}

export default async function StatsPage() {
  await requireAdmin()
  const now = new Date()

  const [representations, totalSieges] = await Promise.all([
    prisma.representation.findMany({ orderBy: { startsAt: 'asc' } }),
    prisma.seat.count(),
  ])

  const stats = await Promise.all(
    representations.map(async (rep) => {
      const [overrides, billets, scannes, bookings] = await Promise.all([
        prisma.seatOverride.count({ where: { representationId: rep.id } }),
        prisma.ticket.count({ where: { representationId: rep.id } }),
        prisma.ticket.count({ where: { representationId: rep.id, scannedAt: { not: null } } }),
        prisma.booking.findMany({
          where: { representationId: rep.id },
          select: { status: true, partySize: true, paymentMethod: true, amountCents: true },
        }),
      ])

      const capacite = totalSieges - overrides
      const parStatut = new Map<string, number>()
      const parTaille = new Map<number, number>()
      // Caisse : demandes payées ou placées (l'argent est encaissé dans les 2 cas).
      const caisse = new Map<string, { nb: number; total: number; sansMontant: number }>()

      for (const b of bookings) {
        parStatut.set(b.status, (parStatut.get(b.status) ?? 0) + 1)
        if (['pending', 'paid', 'placed'].includes(b.status)) {
          parTaille.set(b.partySize, (parTaille.get(b.partySize) ?? 0) + 1)
        }
        if (['paid', 'placed'].includes(b.status)) {
          const methode = b.paymentMethod ?? 'inconnu'
          const ligne = caisse.get(methode) ?? { nb: 0, total: 0, sansMontant: 0 }
          ligne.nb += 1
          if (b.amountCents !== null) ligne.total += b.amountCents
          else ligne.sansMontant += 1
          caisse.set(methode, ligne)
        }
      }

      const totalCaisse = [...caisse.values()].reduce((s, l) => s + l.total, 0)
      const passee = rep.startsAt < now

      return {
        rep,
        capacite,
        billets,
        scannes,
        remplissage: capacite > 0 ? Math.round((billets / capacite) * 100) : 0,
        noShows: passee ? billets - scannes : null,
        parStatut,
        parTaille,
        caisse,
        totalCaisse,
      }
    }),
  )

  return (
    <main className={styles.page}>
      <h1>Statistiques</h1>

      {stats.map(({ rep, ...s }) => (
        <section key={rep.id} className={styles.bloc}>
          <header className={styles.blocHeader}>
            <h2>{rep.title}</h2>
            <span className={styles.date}>
              {dateHeureFr.format(rep.startsAt).replace(/(\d{1,2}):(\d{2})/, '$1h$2')}
            </span>
          </header>

          <div className={styles.grille}>
            <div className={styles.carte}>
              <h3>Remplissage</h3>
              <p className={styles.gros}>
                {s.billets} / {s.capacite} <small>({s.remplissage} %)</small>
              </p>
              <p className={styles.detail}>billets émis / sièges actifs</p>
              {s.noShows !== null && (
                <p className={styles.detail}>
                  Entrées scannées : <strong>{s.scannes}</strong> — no-shows :{' '}
                  <strong>{s.noShows}</strong>
                </p>
              )}
            </div>

            <div className={styles.carte}>
              <h3>Demandes</h3>
              <ul className={styles.liste}>
                {(
                  [
                    ['pending', 'En attente'],
                    ['paid', 'À placer'],
                    ['placed', 'Placées'],
                    ['cancelled', 'Annulées'],
                    ['expired', 'Expirées'],
                  ] as const
                ).map(([statut, label]) => (
                  <li key={statut}>
                    {label} : <strong>{s.parStatut.get(statut) ?? 0}</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div className={styles.carte}>
              <h3>Tailles de groupes</h3>
              {s.parTaille.size === 0 ? (
                <p className={styles.detail}>Aucune demande active.</p>
              ) : (
                <ul className={styles.liste}>
                  {[...s.parTaille.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([taille, nb]) => (
                      <li key={taille}>
                        {taille} place{taille > 1 ? 's' : ''} : <strong>{nb}</strong> demande
                        {nb > 1 ? 's' : ''}
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className={styles.carte}>
              <h3>Caisse</h3>
              {s.caisse.size === 0 ? (
                <p className={styles.detail}>Aucun règlement enregistré.</p>
              ) : (
                <>
                  <ul className={styles.liste}>
                    {[...s.caisse.entries()].map(([methode, ligne]) => (
                      <li key={methode}>
                        {METHODE_LABELS[methode] ?? methode} : <strong>{euros(ligne.total)}</strong>{' '}
                        ({ligne.nb} demande{ligne.nb > 1 ? 's' : ''}
                        {ligne.sansMontant > 0 ? `, ${ligne.sansMontant} sans montant` : ''})
                      </li>
                    ))}
                  </ul>
                  <p className={styles.totalCaisse}>Total : {euros(s.totalCaisse)}</p>
                </>
              )}
              <p className={styles.detail}>
                Renseigné au « Marquer payée » dans{' '}
                <Link href={`/admin/demandes?rep=${rep.id}`}>les demandes</Link>.
              </p>
            </div>
          </div>
        </section>
      ))}
    </main>
  )
}
