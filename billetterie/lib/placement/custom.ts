// ╔══════════════════════════════════════════════════════════════════╗
// ║  TON terrain de jeu. La spec complète est dans PLACEMENT.md :     ║
// ║  runs, fenêtres glissantes, malus de sièges orphelins, scission.  ║
// ╚══════════════════════════════════════════════════════════════════╝
//
// Pour activer ton implémentation :
//  - passe `implemented` à true (les tests d'invariants s'activent dessus) ;
//  - lance l'appli ou le simulateur avec PLACEMENT_IMPL=custom
//    (ex. PLACEMENT_IMPL=custom pnpm simulate --runs=200 --seed=42).
//
// Contrat à respecter : lib/placement/types.ts (fonction pure, déterministe,
// au plus 3 suggestions triées, invariants 1-5).

import type { PlacementFn } from './types'

export const implemented = false

export const suggestPlacement: PlacementFn = (_seats, _partySize) => {
  // TODO: à toi de jouer
  throw new Error('placement custom non implémenté — voir PLACEMENT.md')
}
