// Accès à UNE place (un billet), pour la vue lecture seule partagée. Deux
// portes :
//   - trouverPlaceParCode(email, code) : le code court « GC1234 » dicté à une
//     copine, CADRÉ par l'email du propriétaire (jamais la place d'un inconnu,
//     garde-fou chiffre de contrôle) ;
//   - vuePlaceParQrToken(qrToken) : le lien direct « tout-en-un » (le qrToken
//     est déjà la capacité publique du QR), rien à taper.
// Pendant de lib/booking/acces.ts (qui retrouve toute une réservation). Client
// injecté (db) → testable sur DB jetable, comme lib/auth/login-code.ts.

import type { PrismaClient } from '@prisma/client'

import { normaliserCode } from './code'
import { codePlace, controleValide } from './code-place'

export type VuePlace = {
  sectionId: string // "gauche" | "centre" | "droite" (le libellé est fait côté UI)
  rang: string
  place: number
  qrToken: string
  proprioPrenom: string // prénom seul, pour le récap « groupe de … »
  repTitre: string
  repDate: Date
}

export type PlaceResultat = { type: 'trouvee'; vue: VuePlace } | { type: 'introuvable' }

// Champs lus pour bâtir une VuePlace (mêmes pour les deux portes).
const SELECT_TICKET = {
  qrToken: true,
  booking: { select: { name: true } },
  seat: {
    select: { number: true, row: { select: { label: true, section: { select: { id: true } } } } },
  },
  representation: { select: { title: true, startsAt: true } },
} as const

type TicketVue = {
  qrToken: string
  booking: { name: string }
  seat: { number: number; row: { label: string; section: { id: string } } }
  representation: { title: string; startsAt: Date }
}

// Prénom = premier mot du nom complet « Prénom Nom ».
function prenom(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

function vueDepuis(t: TicketVue): VuePlace {
  return {
    sectionId: t.seat.row.section.id,
    rang: t.seat.row.label,
    place: t.seat.number,
    qrToken: t.qrToken,
    proprioPrenom: prenom(t.booking.name),
    repTitre: t.representation.title,
    repDate: t.representation.startsAt,
  }
}

// Code court « GC1234 », CADRÉ par l'email du propriétaire.
export async function trouverPlaceParCode(
  db: PrismaClient,
  emailRaw: string,
  codeRaw: string,
): Promise<PlaceResultat> {
  const email = emailRaw.trim().toLowerCase()
  const code = normaliserCode(codeRaw)
  // Garde-fou chiffre de contrôle : une faute de frappe est écartée SANS requête.
  if (!email || !controleValide(code)) return { type: 'introuvable' }

  // Billets des réservations PLACÉES de cet email (seules à avoir un siège).
  const tickets = await db.ticket.findMany({
    where: { booking: { email, status: 'placed' } },
    select: SELECT_TICKET,
  })
  const match = tickets.find((t) => codePlace(t.qrToken, t.booking.name) === code)
  return match ? { type: 'trouvee', vue: vueDepuis(match) } : { type: 'introuvable' }
}

// Lien direct : le qrToken (déjà public via /api/qr/<token>) désigne le billet.
export async function vuePlaceParQrToken(
  db: PrismaClient,
  qrToken: string,
): Promise<VuePlace | null> {
  const t = await db.ticket.findUnique({ where: { qrToken }, select: SELECT_TICKET })
  return t ? vueDepuis(t) : null
}
