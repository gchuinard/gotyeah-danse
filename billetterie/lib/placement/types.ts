// Contrat du moteur de placement — interface PURE, aucune dépendance Prisma.
//
// L'appelant (back-office, simulateur, tests) construit le tableau de
// SeatState pour UNE représentation (sièges actifs uniquement : les sièges
// bloqués par SeatOverride sont simplement absents du tableau), puis demande
// jusqu'à 3 suggestions pour un groupe de `partySize` personnes.
// La fonction ne mute JAMAIS son entrée et est déterministe : mêmes sièges,
// même taille → mêmes suggestions, quel que soit l'ordre du tableau d'entrée.

export type SeatState = {
  id: string // ex. "centre-A-03"
  section: string // 'gauche' | 'centre' | 'droite'
  rowId: string // ex. "centre-A" — la contiguïté n'existe QU'AU SEIN d'un rowId
  rowLabel: string
  rowOrder: number // 0 = rang le plus proche de la scène
  indexInRow: number // position dans SA section — consécutifs = voisins
  number: number // numéro affiché sur le billet
  score: number // score statique 0-100 (qualité intrinsèque du siège)
  free: boolean // false = déjà occupé par un Ticket
}

export type Suggestion = {
  seatIds: string[] // exactement partySize sièges, tous free
  score: number // qualité de la suggestion — informatif (affiché à l'admin)
}

// Invariants (vérifiés par tests/placement/invariants.test.ts) :
//  1. au plus 3 suggestions, ordonnées de la plus recommandée à la moins
//     recommandée selon le classement PROPRE à l'implémentation (la première
//     est celle proposée par défaut) — `score` est informatif, pas un tri ;
//  2. chaque suggestion contient exactement partySize sièges, tous free ;
//  3. les sièges d'une suggestion forment, par rowId, des indexInRow
//     consécutifs (jamais de trou, jamais de saut de section) ;
//  4. une suggestion occupe K rangées (K ≥ 1) de la MÊME section, de rowOrder
//     CONSÉCUTIFS ; les sièges de chaque rangée sont contigus (cf. 3) ; et
//     toutes les plages d'indexInRow partagent au moins une colonne commune
//     (intersection non vide) — le groupe forme un bloc vertical d'un seul
//     tenant (les uns devant les autres) ;
//  5. déterminisme : l'ordre du tableau d'entrée ne change pas le résultat.
export type PlacementFn = (seats: SeatState[], partySize: number) => Suggestion[]
