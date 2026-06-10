// Point d'entrée du placement : choisit l'implémentation via paramètre
// explicite (simulateur, tests) ou via la variable d'env PLACEMENT_IMPL
// (appli). Défaut : baseline.

import { suggestPlacement as baseline } from './baseline'
import { implemented as customImplemented, suggestPlacement as custom } from './custom'
import type { PlacementFn } from './types'

export type PlacementImpl = 'baseline' | 'custom'

export const PLACEMENT_IMPLS: Record<PlacementImpl, { fn: PlacementFn; implemented: boolean }> = {
  baseline: { fn: baseline, implemented: true },
  custom: { fn: custom, implemented: customImplemented },
}

export function getPlacement(impl?: PlacementImpl): PlacementFn {
  const choice = impl ?? (process.env.PLACEMENT_IMPL === 'custom' ? 'custom' : 'baseline')
  return PLACEMENT_IMPLS[choice].fn
}

export type { PlacementFn, SeatState, Suggestion } from './types'
