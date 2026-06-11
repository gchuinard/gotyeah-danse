// Utilitaires des tests de placement : fixtures lisibles, salle réelle,
// shuffle seedé. AUCUN accès DB, AUCUN Date.now()/Math.random().

import { venueConfig } from '@/config/venue'
import type { SeatState } from '@/lib/placement/types'
import { generateSeats } from '@/lib/venue/generate'

type RowSpec = {
  rowId: string
  section: string
  rowLabel?: string
  rowOrder: number
  indexes: number[] // indexInRow présents — permet de modéliser des trous
  occupied?: number[] // indexInRow des sièges déjà pris (free: false)
  score?: (indexInRow: number) => number
}

// Construit une rangée artisanale, lisible dans les tests.
export function row(spec: RowSpec): SeatState[] {
  const occupied = new Set(spec.occupied ?? [])
  return spec.indexes.map((indexInRow) => ({
    id: `${spec.rowId}-${String(indexInRow).padStart(2, '0')}`,
    section: spec.section,
    rowId: spec.rowId,
    rowLabel: spec.rowLabel ?? spec.rowId,
    rowOrder: spec.rowOrder,
    indexInRow,
    number: indexInRow + 1,
    score: spec.score ? spec.score(indexInRow) : 50,
    free: !occupied.has(indexInRow),
  }))
}

// Salle réelle (818 sièges) : projection GeneratedSeat → SeatState.
// `estLibre` décide de l'occupation (par défaut : tout est libre).
export function salleReelle(
  estLibre: (seatId: string, index: number) => boolean = () => true,
): SeatState[] {
  return generateSeats(venueConfig).map((s, i) => ({
    id: s.id,
    section: s.section,
    rowId: s.rowId,
    rowLabel: s.rowLabel,
    rowOrder: s.rowOrder,
    indexInRow: s.indexInRow,
    number: s.number,
    score: s.score,
    free: estLibre(s.id, i),
  }))
}

// PRNG mulberry32 : aléa reproductible à partir d'une graine fixe.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Fisher-Yates seedé — retourne une COPIE, l'entrée n'est pas touchée.
export function shuffleSeede<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
