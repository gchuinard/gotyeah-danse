// /billets/[publicToken] — page publique de suivi d'une demande de places.
//
// Le token UUID est la SEULE clé d'accès : token inconnu → 404, aucun
// listing ni indice possible (pas d'énumération). Le contenu dépend du
// statut du booking (pending / paid / placed / cancelled / expired).

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'

import PrintButton from './print-button'
import QrFullscreen from './qr-fullscreen'
import styles from './billets.module.css'

// La donnée change côté admin (placement, expiration) : jamais de cache.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Suivi de votre demande — Billetterie',
}

// Libellés affichés des sections (ids en base : gauche / centre / droite).
const SECTION_LABELS: Record<string, string> = {
  gauche: 'Gauche',
  centre: 'Centre',
  droite: 'Droite',
}

// Dates en français, heure de Paris. « 20:30 » → « 20h30 ».
const formatDateHeure = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(d)
    .replace(/(\d{2}):(\d{2})/, '$1h$2')

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)

export default async function BilletsPage({
  params,
}: {
  params: Promise<{ publicToken: string }>
}) {
  const { publicToken } = await params

  const booking = await prisma.booking.findUnique({
    where: { publicToken },
    include: {
      representation: true,
      tickets: {
        include: { seat: { include: { row: { include: { section: true } } } } },
        orderBy: { seatId: 'asc' },
      },
    },
  })
  if (!booking) notFound()

  const rep = booking.representation
  const repDate = formatDateHeure(rep.startsAt)

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {booking.status === 'pending' && (
          <>
            <header className={styles.header}>
              <p className={styles.kicker}>Billetterie du spectacle</p>
              <h1 className={styles.title}>Demande enregistrée</h1>
            </header>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Votre demande</h2>
              <dl className={styles.recap}>
                <div className={styles.recapRow}>
                  <dt>Représentation</dt>
                  <dd>{rep.title}</dd>
                </div>
                <div className={styles.recapRow}>
                  <dt>Date</dt>
                  <dd>{repDate}</dd>
                </div>
                <div className={styles.recapRow}>
                  <dt>Places demandées</dt>
                  <dd>
                    {booking.partySize} place{booking.partySize > 1 ? 's' : ''}
                  </dd>
                </div>
                <div className={styles.recapRow}>
                  <dt>Au nom de</dt>
                  <dd>{booking.name}</dd>
                </div>
              </dl>
            </section>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Règlement</h2>
              <p className={styles.text}>
                Pour confirmer votre réservation, merci de régler vos places par chèque (à
                l&apos;ordre de l&apos;école) ou en espèces, lors des permanences de l&apos;école.
              </p>
              {booking.expiresAt && (
                <p className={styles.deadline}>
                  Date limite de règlement : <strong>{formatDate(booking.expiresAt)}</strong>.
                  Passé ce délai, la demande expirera et les places seront libérées.
                </p>
              )}
            </section>
          </>
        )}

        {booking.status === 'paid' && (
          <>
            <header className={styles.header}>
              <p className={styles.kicker}>Billetterie du spectacle</p>
              <h1 className={styles.title}>Paiement reçu</h1>
            </header>
            <section className={styles.card}>
              <p className={styles.text}>
                Nous avons bien reçu votre règlement pour {booking.partySize} place
                {booking.partySize > 1 ? 's' : ''} — {rep.title}, {repDate}.
              </p>
              <p className={styles.text}>
                Vos places sont en cours d&apos;attribution. Revenez sur cette page : elle se
                mettra à jour dès que vos billets seront prêts.
              </p>
            </section>
          </>
        )}

        {booking.status === 'placed' && (
          <>
            <header className={`${styles.header} ${styles.screenOnly}`}>
              <p className={styles.kicker}>Billetterie du spectacle</p>
              <h1 className={styles.title}>Vos billets</h1>
              <p className={styles.text}>
                Présentez le QR code de chaque billet à l&apos;entrée de la salle. Vous pouvez les
                imprimer ou les garder sur votre téléphone.
              </p>
              <PrintButton />
            </header>
            <section className={styles.tickets}>
              {booking.tickets.map((t) => (
                <article key={t.id} className={styles.ticket}>
                  <div className={styles.ticketInfo}>
                    <p className={styles.ticketKicker}>Spectacle de fin d&apos;année</p>
                    <h2 className={styles.ticketTitle}>{rep.title}</h2>
                    <p className={styles.ticketDate}>{repDate}</p>
                    <dl className={styles.ticketSeat}>
                      <div>
                        <dt>Section</dt>
                        <dd>{SECTION_LABELS[t.seat.row.section.id] ?? t.seat.row.section.name}</dd>
                      </div>
                      <div>
                        <dt>Rang</dt>
                        <dd>{t.seat.row.label}</dd>
                      </div>
                      <div>
                        <dt>Place</dt>
                        <dd>{t.seat.number}</dd>
                      </div>
                    </dl>
                    <p className={styles.ticketName}>{booking.name}</p>
                  </div>
                  {/* QR généré à la volée — n'encode que le qrToken, aucune donnée
                      personnelle. Tap → plein écran (scan facile à l'entrée). */}
                  <QrFullscreen
                    src={`/api/qr/${t.qrToken}.png`}
                    rang={t.seat.row.label}
                    place={t.seat.number}
                    titre={rep.title}
                  />
                </article>
              ))}
            </section>
          </>
        )}

        {booking.status === 'cancelled' && (
          <>
            <header className={styles.header}>
              <p className={styles.kicker}>Billetterie du spectacle</p>
              <h1 className={styles.title}>Demande annulée</h1>
            </header>
            <section className={styles.card}>
              <p className={styles.text}>
                Cette demande de places a été annulée. Si vous pensez qu&apos;il s&apos;agit
                d&apos;une erreur, contactez l&apos;école.
              </p>
            </section>
          </>
        )}

        {booking.status === 'expired' && (
          <>
            <header className={styles.header}>
              <p className={styles.kicker}>Billetterie du spectacle</p>
              <h1 className={styles.title}>Demande expirée</h1>
            </header>
            <section className={styles.card}>
              <p className={styles.text}>
                Le délai de règlement est dépassé et les places de cette demande ont été libérées.
                S&apos;il reste des places, vous pouvez refaire une demande depuis la{' '}
                <Link className={styles.link} href="/">
                  page d&apos;accueil
                </Link>
                .
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
