// Baseline VOLONTAIREMENT naïve : première fenêtre libre en partant du rang A.
//
// Elle ignore le score des sièges, ne scinde jamais un groupe, et remplit la
// salle dans l'ordre de lecture. C'est le point de comparaison du simulateur :
// NE PAS l'améliorer — l'algorithme intelligent, c'est lib/placement/custom.ts.

import type { PlacementFn, SeatState, Suggestion } from './types'

export const suggestPlacement: PlacementFn = (seats, partySize) => {
  if (partySize < 1 || !Number.isInteger(partySize)) return []

  // Rangées triées scène → fond puis jardin → cour, sièges par indexInRow.
  // On reconstruit le tri ici pour rester déterministe quel que soit l'ordre
  // du tableau d'entrée.
  const byRow = new Map<string, SeatState[]>()
  for (const seat of seats) {
    const row = byRow.get(seat.rowId)
    if (row) row.push(seat)
    else byRow.set(seat.rowId, [seat])
  }
  const rows = [...byRow.values()]
    .map((row) => [...row].sort((a, b) => a.indexInRow - b.indexInRow))
    .sort((a, b) => a[0].rowOrder - b[0].rowOrder || a[0].rowId.localeCompare(b[0].rowId))

  const suggestions: Suggestion[] = []
  for (const row of rows) {
    for (let i = 0; i + partySize <= row.length; i++) {
      const window = row.slice(i, i + partySize)
      const contiguousAndFree = window.every(
        (s, j) => s.free && s.indexInRow === window[0].indexInRow + j,
      )
      if (!contiguousAndFree) continue
      suggestions.push({
        seatIds: window.map((s) => s.id),
        score: window.reduce((sum, s) => sum + s.score, 0),
      })
      if (suggestions.length === 3) return suggestions
      i += partySize - 1 // fenêtres disjointes : 3 propositions vraiment différentes
    }
  }
  return suggestions
}
