// /admin — tableau de bord : une carte par représentation ACTIVE (même
// fermées ; les archivées, elles, ne sont plus du quotidien — leurs chiffres
// restent dans /admin/stats). Tout est CALCULÉ (capacité, remplissage, jauge),
// rien de stocké.

import type { Metadata } from 'next'
import Link from 'next/link'

import AutoRefresh from '@/components/admin/auto-refresh'
import { REP_ACTIVE } from '@/lib/admin/archive'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { computeJauge } from '@/lib/jauge'

import styles from './dashboard.module.css'

export const metadata: Metadata = { title: 'Tableau de bord — Billetterie admin' }

const dateHeureFr = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export default async function DashboardPage() {
  await requireAdmin()

  const now = new Date()
  const [representations, totalSieges] = await Promise.all([
    prisma.representation.findMany({ where: REP_ACTIVE, orderBy: { startsAt: 'asc' } }),
    prisma.seat.count(),
  ])

  const cartes = await Promise.all(
    representations.map(async (rep) => {
      const [overrides, billets, scannes, pending, paid, placesNonRegles, jauge] =
        await Promise.all([
          prisma.seatOverride.count({ where: { representationId: rep.id } }),
          prisma.ticket.count({ where: { representationId: rep.id } }),
          prisma.ticket.count({ where: { representationId: rep.id, scannedAt: { not: null } } }),
          prisma.booking.aggregate({
            _count: true,
            _sum: { partySize: true },
            where: { representationId: rep.id, status: 'pending' },
          }),
          prisma.booking.aggregate({
            _count: true,
            _sum: { partySize: true },
            where: { representationId: rep.id, status: 'paid' },
          }),
          // Placés mais pas encore réglés (paiement après coup) — à relancer le soir J.
          prisma.booking.aggregate({
            _count: true,
            _sum: { partySize: true },
            where: { representationId: rep.id, status: 'placed', paidAt: null },
          }),
          computeJauge(prisma, rep.id, now),
        ])
      const capacite = totalSieges - overrides
      return {
        rep,
        capacite,
        billets,
        scannes,
        remplissage: capacite > 0 ? Math.round((billets / capacite) * 100) : 0,
        pendingNb: pending._count,
        pendingPlaces: pending._sum.partySize ?? 0,
        paidNb: paid._count,
        paidPlaces: paid._sum.partySize ?? 0,
        placesNonReglesNb: placesNonRegles._count,
        placesNonReglesPlaces: placesNonRegles._sum.partySize ?? 0,
        jauge,
      }
    }),
  )

  return (
    <main className={styles.page}>
      {/* Soir J : les compteurs (scannés notamment) se rafraîchissent seuls. */}
      <AutoRefresh seconds={30} />
      <h1>Tableau de bord</h1>

      {cartes.length === 0 && (
        <p className={styles.vide}>
          Aucune représentation active. Crée-en une — ou désarchive-en une — dans{' '}
          <Link href="/admin/representations">Représentations</Link>.
        </p>
      )}

      <div className={styles.cartes}>
        {cartes.map(({ rep, ...c }) => (
          <section key={rep.id} className={styles.carte}>
            <header className={styles.carteHeader}>
              <h2>{rep.title}</h2>
              <span className={rep.isOpen ? styles.ouverte : styles.fermee}>
                {rep.isOpen ? 'Réservations ouvertes' : 'Fermée'}
              </span>
            </header>
            <p className={styles.date}>{dateHeureFr.format(rep.startsAt).replace(/(\d{1,2}):(\d{2})/, '$1h$2')}</p>

            <div className={styles.jaugeBarre} role="presentation">
              <div className={styles.jaugeRemplie} style={{ width: `${Math.min(c.remplissage, 100)}%` }} />
            </div>
            <p className={styles.remplissage}>
              {c.billets} billet{c.billets > 1 ? 's' : ''} émis / {c.capacite} sièges actifs — {c.remplissage} %
            </p>

            <dl className={styles.stats}>
              <div>
                <dt>Capacité active</dt>
                <dd>{c.capacite}</dd>
              </div>
              <div>
                <dt>Billets émis</dt>
                <dd>{c.billets}</dd>
              </div>
              <div>
                <dt>En attente</dt>
                <dd>
                  {c.pendingNb} demande{c.pendingNb > 1 ? 's' : ''} · {c.pendingPlaces} place{c.pendingPlaces > 1 ? 's' : ''}
                </dd>
              </div>
              <div>
                <dt>À placer</dt>
                <dd>
                  {c.paidNb} demande{c.paidNb > 1 ? 's' : ''} · {c.paidPlaces} place{c.paidPlaces > 1 ? 's' : ''}
                </dd>
              </div>
              <div>
                <dt>Placés non réglés</dt>
                <dd className={c.placesNonReglesNb > 0 ? styles.alerte : undefined}>
                  {c.placesNonReglesNb} demande{c.placesNonReglesNb > 1 ? 's' : ''} ·{' '}
                  {c.placesNonReglesPlaces} place{c.placesNonReglesPlaces > 1 ? 's' : ''}
                </dd>
              </div>
              <div>
                <dt>Jauge restante</dt>
                <dd>{c.jauge}</dd>
              </div>
              <div>
                <dt>Scannés</dt>
                <dd>
                  {c.scannes} / {c.billets} billet{c.billets > 1 ? 's' : ''}
                </dd>
              </div>
            </dl>

            <footer className={styles.liens}>
              <Link className={styles.lienPrincipal} href={`/admin/demandes?rep=${rep.id}`}>
                Voir les demandes
              </Link>
              <a className={styles.lienExport} href={`/api/admin/export/${rep.id}`}>
                Export CSV
              </a>
            </footer>
          </section>
        ))}
      </div>
    </main>
  )
}
