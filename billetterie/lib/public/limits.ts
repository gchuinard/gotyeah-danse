// Limites partagées des demandes — UN seul endroit à changer.
//
// MAX_PARTY_SIZE : taille maximale d'un groupe par demande. Le moteur de
// placement sait répartir un groupe en bloc compact sur plusieurs rangs
// voisins (lib/placement/custom.ts) ; au-delà, il rend « aucune suggestion »
// et le placement se fait à la main — rien ne casse.

export const MAX_PARTY_SIZE = 20

// Options du menu « nombre de places » (1 … MAX_PARTY_SIZE).
export const PARTY_SIZES = Array.from({ length: MAX_PARTY_SIZE }, (_, i) => i + 1)
