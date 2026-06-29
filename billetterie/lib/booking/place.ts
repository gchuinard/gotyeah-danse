// Lookup d'UNE place par code de partage (« GC1234 »), CADRÉ par l'email du
// propriétaire. Pendant de lib/booking/acces.ts (qui retrouve une réservation) :
// ici on retrouve un BILLET précis, pour la vue lecture seule partagée.
//
// Le cadrage par email est le vrai garde-fou : le code n'est comparé qu'aux
// billets de cette adresse → une faute de frappe ne peut jamais désigner la
// place d'un INCONNU (au pire une autre place du même groupe, que le chiffre de
// contrôle écarte le plus souvent, et que le récap « groupe de … » montre).
// Client injecté (db) → testable sur DB jetable, comme lib/auth/login-code.ts.

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

// Prénom = premier mot du nom complet « Prénom Nom ».
function prenom(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

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
    select: {
      qrToken: true,
      booking: { select: { name: true } },
      seat: {
        select: {
          number: true,
          row: { select: { label: true, section: { select: { id: true } } } },
        },
      },
      representation: { select: { title: true, startsAt: true } },
    },
  })
  const match = tickets.find((t) => codePlace(t.qrToken, t.booking.name) === code)
  if (!match) return { type: 'introuvable' }

  return {
    type: 'trouvee',
    vue: {
      sectionId: match.seat.row.section.id,
      rang: match.seat.row.label,
      place: match.seat.number,
      qrToken: match.qrToken,
      proprioPrenom: prenom(match.booking.name),
      repTitre: match.representation.title,
      repDate: match.representation.startsAt,
    },
  }
}
