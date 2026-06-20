// Météo du soir J, relevée à trois moments (début / milieu / fin) — saisie à la
// main dans le bilan d'organisation (page /admin/stats), pour capitaliser d'une
// année sur l'autre. Stockée en JSON dans Representation.weatherReadings.
//
// Fonctions pures (aucune dépendance Prisma) : parse robuste du JSON stocké,
// normalisation des valeurs et sérialisation. Testées dans tests/admin/weather.

export type MomentKey = 'debut' | 'milieu' | 'fin'

export const MOMENTS: { key: MomentKey; label: string }[] = [
  { key: 'debut', label: 'Début de soirée' },
  { key: 'milieu', label: 'Milieu' },
  { key: 'fin', label: 'Fin' },
]

// Conditions de ciel proposées dans le menu déroulant. '' = non renseigné.
export const SKY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '—' },
  { value: 'soleil', label: '☀️ Soleil' },
  { value: 'eclaircies', label: '🌤️ Éclaircies' },
  { value: 'nuageux', label: '⛅ Nuageux' },
  { value: 'couvert', label: '☁️ Couvert' },
  { value: 'pluie', label: '🌧️ Pluie' },
  { value: 'averses', label: '🌦️ Averses' },
  { value: 'orage', label: '⛈️ Orage' },
  { value: 'vent', label: '💨 Vent' },
  { value: 'brouillard', label: '🌫️ Brouillard' },
]

const SKY_VALUES = new Set(SKY_OPTIONS.map((o) => o.value))
const SKY_LABELS = new Map(SKY_OPTIONS.map((o) => [o.value, o.label]))

// Bornes de température (°C) — large mais filtre les saisies aberrantes.
const TEMP_MIN = -30
const TEMP_MAX = 60

export type MomentReading = { sky: string; tempC: number | null }
export type WeatherReadings = Record<MomentKey, MomentReading>

export function emptyReadings(): WeatherReadings {
  return {
    debut: { sky: '', tempC: null },
    milieu: { sky: '', tempC: null },
    fin: { sky: '', tempC: null },
  }
}

// Ciel inconnu → '' ; n'accepte qu'une valeur de la liste blanche.
export function normalizeSky(value: unknown): string {
  return typeof value === 'string' && SKY_VALUES.has(value) ? value : ''
}

// Température : nombre fini arrondi et borné, sinon null (vide ou aberrant).
export function normalizeTemp(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.replace(',', '.'))
        : NaN
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded < TEMP_MIN || rounded > TEMP_MAX) return null
  return rounded
}

export function normalizeReading(value: unknown): MomentReading {
  const o = (value ?? {}) as Record<string, unknown>
  return { sky: normalizeSky(o.sky), tempC: normalizeTemp(o.tempC) }
}

// JSON stocké → objet complet (3 moments toujours présents). Robuste au legacy
// et au JSON corrompu : tout ce qui n'est pas reconnu retombe sur du vide.
export function parseWeatherReadings(json: string | null | undefined): WeatherReadings {
  if (!json) return emptyReadings()
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return emptyReadings()
  }
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    debut: normalizeReading(o.debut),
    milieu: normalizeReading(o.milieu),
    fin: normalizeReading(o.fin),
  }
}

export function isReadingEmpty(r: MomentReading): boolean {
  return r.sky === '' && r.tempC === null
}

export function areReadingsEmpty(w: WeatherReadings): boolean {
  return MOMENTS.every((m) => isReadingEmpty(w[m.key]))
}

// Objet → JSON à stocker, ou null si tout est vide (ne rien garder d'inutile).
export function serializeWeatherReadings(w: WeatherReadings): string | null {
  return areReadingsEmpty(w) ? null : JSON.stringify(w)
}

export function skyLabel(value: string): string {
  return SKY_LABELS.get(value) ?? '—'
}

// Résumé lisible d'un relevé (ex. « ☀️ Soleil · 24 °C », ou « — » si vide).
export function formatReading(r: MomentReading): string {
  const parts: string[] = []
  if (r.sky) parts.push(skyLabel(r.sky))
  if (r.tempC !== null) parts.push(`${r.tempC} °C`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}
