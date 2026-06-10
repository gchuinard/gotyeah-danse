// E-mails métier liés aux réservations.
//
// Consommé par le formulaire public : retourne un booléen, ne jette jamais
// (voir lib/email/send.ts). Aucun accès DB ici — tout arrive en paramètre.

import { render } from 'react-email'
import BookingPendingEmail from '@/emails/booking-pending'
import { sendEmail } from './send'

// Dates en français, fuseau Europe/Paris (le serveur peut tourner en UTC).
const formatDateHeure = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

// Intl produit « 20:30 » ; l'usage français est « 20h30 ».
function dateHeureFr(d: Date): string {
  return formatDateHeure.format(d).replace(/(\d{1,2}):(\d{2})/, '$1h$2')
}

const formatDate = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export async function sendBookingPendingEmail(booking: {
  name: string
  email: string
  partySize: number
  publicToken: string
  expiresAt: Date | null
  representation: { title: string; startsAt: Date }
}): Promise<boolean> {
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000'
  const billetsUrl = `${baseUrl}/billets/${booking.publicToken}`

  const html = await render(
    BookingPendingEmail({
      name: booking.name,
      partySize: booking.partySize,
      representationTitle: booking.representation.title,
      representationDateText: dateHeureFr(booking.representation.startsAt),
      // Sans date d'expiration (cas théorique), on retombe sur le délai générique.
      dateLimiteText: booking.expiresAt
        ? formatDate.format(booking.expiresAt)
        : 'la fin du délai de 14 jours',
      billetsUrl,
    }),
  )

  return sendEmail({
    to: booking.email,
    toName: booking.name,
    subject: `Votre demande de places — ${booking.representation.title}`,
    html,
  })
}
