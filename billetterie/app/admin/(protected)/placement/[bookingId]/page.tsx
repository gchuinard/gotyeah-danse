// /admin/placement/[bookingId] — L'écran de placement.
//
// Deux modes :
//  - statut paid                     → émission des billets ;
//  - statut placed + ?mode=deplacer  → déplacement des places existantes
//    (les sièges actuels du booking sont considérés libres pour le moteur
//    de suggestions, et cliquables sur le plan).
// Tout autre statut → message + lien retour.

import type { Metadata } from 'next'
import Link from 'next/link'

import { getSeatMap, toSeatStates, type SeatView } from '@/lib/admin/seat-map'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { getPlacement } from '@/lib/placement'

import PlacementView from './placement-view'
import styles from './placement.module.css'

export const metadata: Metadata = {
  title: 'Placement',
}

const formatDateHeure = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
})

const STATUS_MESSAGES: Record<string, string> = {
  pending: 'Cette demande n’est pas encore payée — le placement se fait après le paiement.',
  cancelled: 'Cette demande a été annulée.',
  expired: 'Cette demande a expiré.',
}

function Retour() {
  return (
    <p>
      <Link className={styles.backLink} href="/admin/demandes">
        ← Retour aux demandes
      </Link>
    </p>
  )
}

export default async function PlacementPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>
  searchParams: Promise<{ mode?: string | string[] }>
}) {
  await requireAdmin()

  const { bookingId } = await params
  const { mode: modeParam } = await searchParams
  const wantsDeplacement = (Array.isArray(modeParam) ? modeParam[0] : modeParam) === 'deplacer'

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      representation: { select: { id: true, title: true, startsAt: true } },
      tickets: { select: { seatId: true } },
    },
  })

  if (!booking) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Demande introuvable</h1>
        <Retour />
      </div>
    )
  }

  const mode: 'emission' | 'deplacement' | null =
    booking.status === 'paid'
      ? 'emission'
      : booking.status === 'placed' && wantsDeplacement
        ? 'deplacement'
        : null

  if (mode === null) {
    const message =
      booking.status === 'placed'
        ? 'Cette demande est déjà placée. Pour déplacer ses places, repassez par la liste des demandes (action « déplacer »).'
        : (STATUS_MESSAGES[booking.status] ?? `Statut « ${booking.status} » : placement impossible.`)
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Placement — {booking.name}</h1>
        <p className={styles.notice}>{message}</p>
        <Retour />
      </div>
    )
  }

  const seatMap = await getSeatMap(prisma, booking.representation.id)
  const currentIds = mode === 'deplacement' ? booking.tickets.map((t) => t.seatId) : []

  // En déplacement, les sièges ACTUELS du booking comptent comme libres pour
  // le moteur (le groupe peut rester sur place ou empiéter sur ses places).
  const currentSet = new Set(currentIds)
  const seatsForEngine: SeatView[] =
    mode === 'deplacement'
      ? seatMap.map((s) =>
          currentSet.has(s.id) ? { ...s, status: 'libre', occupant: undefined } : s,
        )
      : seatMap

  const suggestions = getPlacement()(toSeatStates(seatsForEngine), booking.partySize)

  const isPMR = booking.notes !== null && /pmr|fauteuil|mobilit/i.test(booking.notes)

  return (
    <div className={styles.page}>
      <header className={styles.bandeau}>
        <div>
          <h1 className={styles.title}>
            {mode === 'emission' ? 'Placement' : 'Déplacement'} — {booking.name}
          </h1>
          <p className={styles.meta}>
            {booking.partySize} place{booking.partySize > 1 ? 's' : ''} · {booking.representation.title} —{' '}
            {formatDateHeure.format(booking.representation.startsAt)}
          </p>
        </div>
        {booking.notes && (
          <p className={isPMR ? styles.notesPmr : styles.notes}>
            {isPMR && <strong className={styles.pmrBadge}>PMR</strong>} {booking.notes}
          </p>
        )}
      </header>

      <PlacementView
        bookingId={booking.id}
        mode={mode}
        partySize={booking.partySize}
        seats={seatMap}
        currentIds={currentIds}
        suggestions={suggestions.map((s) => ({ seatIds: s.seatIds, score: s.score }))}
      />
    </div>
  )
}
