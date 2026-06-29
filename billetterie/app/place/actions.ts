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

// Libellés d'affichage des sections (ids en base : gauche / centre / droite).
const SECTION_LABELS: Record<string, string> = {
  gauche: 'Gauche',
  centre: 'Centre',
  droite: 'Droite',
}

// Date en français, heure de Paris. « 20:30 » → « 20h30 ».
const dateHeureFr = (d: Date) =>
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

// Tout sérialisable (chaînes / nombres) → sûr à renvoyer à un composant client.
export type PlaceVue = {
  section: string
  rang: string
  place: number
  qrToken: string
  proprioPrenom: string
  repTitre: string
  repDateLabel: string
}

export type PlaceState = { vue?: PlaceVue; error?: string }

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
      section: SECTION_LABELS[vue.sectionId] ?? vue.sectionId,
      rang: vue.rang,
      place: vue.place,
      qrToken: vue.qrToken,
      proprioPrenom: vue.proprioPrenom,
      repTitre: vue.repTitre,
      repDateLabel: dateHeureFr(vue.repDate),
    },
  }
}
