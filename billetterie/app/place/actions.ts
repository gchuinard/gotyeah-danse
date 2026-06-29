'use server'

// Vue lecture seule d'UNE place partagée : email de la réservation + code de la
// place (« GC1234 ») → le siège + son QR. Aucune donnée perso, aucune action.
// Rate-limité par IP (anti-énumération du code) ; réponse générique en cas
// d'échec (pas d'énumération des emails). Ne redirige PAS : le résultat est
// rendu en place (pas d'URL à token, donc rien à sur-partager).

import { trouverPlaceParCode } from '@/lib/booking/place'
import { prisma } from '@/lib/db'
import { clientIp } from '@/lib/net/client-ip'
import { rateLimit } from '@/lib/rate-limit'

import { formatDateHeure, sectionLabel } from './labels'
import type { PlaceCardData } from './place-card'

export type PlaceState = { vue?: PlaceCardData; error?: string }

export async function voirPlace(_prev: PlaceState, formData: FormData): Promise<PlaceState> {
  const ip = await clientIp()
  if (!rateLimit(`place:${ip}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return { error: 'Trop de tentatives, réessayez dans quelques minutes.' }
  }

  const email = String(formData.get('email') ?? '')
  const code = String(formData.get('code') ?? '')
  if (!email.trim() || !code.trim()) {
    return { error: 'Renseignez l’email de la réservation ET le code de la place.' }
  }

  const r = await trouverPlaceParCode(prisma, email, code)
  if (r.type !== 'trouvee') {
    return { error: 'Email ou code incorrect. Vérifiez le code transmis (ex. GC1234).' }
  }

  const { vue } = r
  return {
    vue: {
      titre: vue.repTitre,
      dateLabel: formatDateHeure(vue.repDate),
      section: sectionLabel(vue.sectionId),
      rang: vue.rang,
      place: vue.place,
      qrToken: vue.qrToken,
      proprioPrenom: vue.proprioPrenom,
    },
  }
}
