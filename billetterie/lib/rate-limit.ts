// Rate-limit en mémoire, fenêtre glissante — volontairement simple : un seul
// process Node sur le Pi, une asso, deux séances par an. Perdu au redémarrage,
// c'est assumé. Si un jour il y a plusieurs instances, passer par une table.

const hits = new Map<string, number[]>()
const MAX_KEYS = 5_000 // garde-fou mémoire : purge paresseuse au-delà

export type RateLimitOptions = {
  limit: number // nombre d'appels autorisés…
  windowMs: number // …par fenêtre glissante
}

// true = autorisé (et consomme un jeton), false = limité.
export function rateLimit(key: string, { limit, windowMs }: RateLimitOptions): boolean {
  const now = Date.now()

  if (hits.size > MAX_KEYS) {
    for (const [k, list] of hits) {
      if (list.every((t) => t <= now - windowMs)) hits.delete(k)
    }
  }

  const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  return true
}

// Pour les tests uniquement.
export function resetRateLimit() {
  hits.clear()
}
