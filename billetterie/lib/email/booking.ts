// E-mails métier liés aux réservations.
//
// Consommé par le formulaire public : retourne un booléen, ne jette jamais
// (voir lib/email/send.ts). Aucun accès DB ici — tout arrive en paramètre.

import { render } from 'react-email'
import { codeDemande } from '@/lib/booking/code'
import BookingCancelledEmail from '@/emails/booking-cancelled'
import BookingMovedEmail from '@/emails/booking-moved'
import BookingPendingEmail from '@/emails/booking-pending'
import BookingReminderEmail from '@/emails/booking-reminder'
import BookingTicketsEmail from '@/emails/booking-tickets'
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

// Types structurels : les appelants (routes admin, etc.) passent leurs propres
// objets, on n'importe rien depuis leurs modules.
export type BookingBillets = {
  name: string
  email: string
  publicToken: string
  representation: { title: string; startsAt: Date }
  tickets: Array<{
    qrToken: string
    seat: { number: number; row: { label: string; section: { name: string } } }
  }>
}

function baseUrl(): string {
  return process.env.APP_BASE_URL ?? 'http://localhost:3000'
}

// Aplatit les billets pour les templates : placement + URL du QR servi
// par /api/qr/<token>.png (jamais de data-URL inline dans les mails).
function blocsBillets(booking: BookingBillets) {
  return booking.tickets.map((ticket) => ({
    sectionName: ticket.seat.row.section.name,
    rowLabel: ticket.seat.row.label,
    seatNumber: ticket.seat.number,
    qrUrl: `${baseUrl()}/api/qr/${ticket.qrToken}.png`,
  }))
}

export async function sendBookingPendingEmail(booking: {
  name: string
  email: string
  partySize: number
  publicToken: string
  expiresAt: Date | null
  representation: { title: string; startsAt: Date }
}): Promise<boolean> {
  const billetsUrl = `${baseUrl()}/billets/${booking.publicToken}`

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
      codeDemande: codeDemande(booking.publicToken),
      logoUrl: `${baseUrl()}/logo-desha-moulin.png`,
    }),
  )

  return sendEmail({
    to: booking.email,
    toName: booking.name,
    subject: `Votre demande de places — ${booking.representation.title}`,
    html,
  })
}

// « Petit rappel » — relance J+7 du cron : la demande attend toujours son
// règlement. Même shape structurel que ReminderBooking (lib/admin/cron.ts).
export async function sendReminderEmail(booking: {
  name: string
  email: string
  partySize: number
  publicToken: string
  expiresAt: Date | null
  representation: { title: string; startsAt: Date }
}): Promise<boolean> {
  const html = await render(
    BookingReminderEmail({
      name: booking.name,
      partySize: booking.partySize,
      representationTitle: booking.representation.title,
      representationDateText: dateHeureFr(booking.representation.startsAt),
      // Sans date d'expiration (cas théorique), on retombe sur le délai générique.
      dateLimiteText: booking.expiresAt
        ? formatDate.format(booking.expiresAt)
        : 'la fin du délai de 14 jours',
      billetsUrl: `${baseUrl()}/billets/${booking.publicToken}`,
      logoUrl: `${baseUrl()}/logo-desha-moulin.png`,
    }),
  )

  return sendEmail({
    to: booking.email,
    toName: booking.name,
    subject: `Rappel : votre demande de places — ${booking.representation.title}`,
    html,
  })
}

// « Vos billets » — places attribuées, QR codes prêts.
export async function sendTicketsEmail(booking: BookingBillets): Promise<boolean> {
  const html = await render(
    BookingTicketsEmail({
      name: booking.name,
      representationTitle: booking.representation.title,
      representationDateText: dateHeureFr(booking.representation.startsAt),
      tickets: blocsBillets(booking),
      billetsUrl: `${baseUrl()}/billets/${booking.publicToken}`,
      logoUrl: `${baseUrl()}/logo-desha-moulin.png`,
    }),
  )

  return sendEmail({
    to: booking.email,
    toName: booking.name,
    subject: `Vos billets — ${booking.representation.title}`,
    html,
  })
}

// « Vos places ont été modifiées » — l'équipe a déplacé les places,
// les anciens QR sont révoqués.
export async function sendMovedEmail(booking: BookingBillets): Promise<boolean> {
  const html = await render(
    BookingMovedEmail({
      name: booking.name,
      representationTitle: booking.representation.title,
      representationDateText: dateHeureFr(booking.representation.startsAt),
      tickets: blocsBillets(booking),
      billetsUrl: `${baseUrl()}/billets/${booking.publicToken}`,
      logoUrl: `${baseUrl()}/logo-desha-moulin.png`,
    }),
  )

  return sendEmail({
    to: booking.email,
    toName: booking.name,
    subject: `Vos places ont été modifiées — ${booking.representation.title}`,
    html,
  })
}

// « Votre demande a été annulée » — expiration ou annulation par l'équipe.
export async function sendCancelledEmail(booking: {
  name: string
  email: string
  partySize: number
  representation: { title: string; startsAt: Date }
}): Promise<boolean> {
  const html = await render(
    BookingCancelledEmail({
      name: booking.name,
      partySize: booking.partySize,
      representationTitle: booking.representation.title,
      representationDateText: dateHeureFr(booking.representation.startsAt),
      formulaireUrl: baseUrl(),
      logoUrl: `${baseUrl()}/logo-desha-moulin.png`,
    }),
  )

  return sendEmail({
    to: booking.email,
    toName: booking.name,
    subject: `Votre demande a été annulée — ${booking.representation.title}`,
    html,
  })
}
