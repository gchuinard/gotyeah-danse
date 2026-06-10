// Conversion entre l'heure de Paris (celle que saisit et lit l'admin via les
// <input type="datetime-local">) et les Date UTC stockées en base. Gère
// l'heure d'été/hiver via Intl — pas de lib de dates pour deux fonctions.

const PARIS = 'Europe/Paris'

// Décalage de Paris (en minutes) à un instant donné, ex. +120 en été.
function parisOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS,
    timeZoneName: 'longOffset',
  }).formatToParts(instant)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC'
  const m = name.match(/([+-])(\d{2}):(\d{2})/)
  if (!m) return 0 // "UTC" sec — n'arrive pas pour Paris
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

// "2026-06-20T20:30" (heure de Paris) → Date UTC.
export function parisToUtc(local: string): Date {
  // On lit d'abord la valeur comme si elle était UTC, puis on retranche le
  // décalage de Paris à cet instant (l'erreur d'1 h sur la détermination du
  // décalage n'existe qu'à cheval sur le changement d'heure, à 2-3 h du matin
  // — aucun spectacle ne s'y programme).
  const guess = new Date(`${local}:00Z`)
  return new Date(guess.getTime() - parisOffsetMinutes(guess) * 60_000)
}

// Date UTC → valeur pour <input type="datetime-local"> en heure de Paris.
export function toParisInputValue(date: Date): string {
  const shifted = new Date(date.getTime() + parisOffsetMinutes(date) * 60_000)
  return shifted.toISOString().slice(0, 16)
}
