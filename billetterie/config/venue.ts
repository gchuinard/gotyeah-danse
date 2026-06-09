// Configuration paramétrique de la salle — Centre Culturel de Bergerac.
//
// Salle en éventail : chaque rangée = 3 arcs de cercle concentriques
// (gauche / centre / droite) séparés par des allées. Tout le plan (seed,
// rendu SVG, calibration) est généré depuis ce fichier — RIEN n'est hardcodé.
//
// [À CALIBRER] : cette config initiale est une approximation « à la louche »
// (~600 places, 17 rangées) depuis la description de la salle. L'ajustement
// fin se fait sur /admin/calibration en superposant le plan généré au scan
// de la fiche technique (public/plan-scan.png), en éditant ce fichier
// (hot reload).
//
// Conventions :
//  - angles en degrés, 0 = axe central de la salle, négatif = côté jardin
//    (gauche vu du public), positif = côté cour (droite).
//  - radius en unités SVG arbitraires (≈ cm), mesuré depuis `center`,
//    le point de convergence des arcs situé derrière la scène.
//  - x = cx + r·sin(θ), y = cy − r·cos(θ) → la scène est en bas du plan,
//    les rangs s'éloignent vers le haut.
//  - `seats` est un nombre EXPLICITE par arc : les salles réelles sont
//    irrégulières, on ne déduit jamais le nombre de sièges de la géométrie.

export type SectionId = 'gauche' | 'centre' | 'droite'

export type ArcConfig = {
  section: SectionId
  angleStart: number // degrés, bord jardin de l'arc
  angleEnd: number // degrés, bord cour de l'arc
  seats: number
  removable?: boolean // sièges amovibles (côtés)
}

export type RowConfig = {
  label: string // lettre, A = rang le plus proche de la scène
  radius: number
  arcs: ArcConfig[]
}

export type NumberingScheme = 'continu' | 'pair-impair'

export type VenueConfig = {
  center: { x: number; y: number } // point de convergence (derrière la scène)
  rows: RowConfig[]
  // [À CONFIRMER avec le Centre Culturel]
  // 'continu'    : 1..N de jardin à cour sur toute la rangée
  // 'pair-impair': impairs côté jardin, pairs côté cour, croissants du centre
  numberingScheme: NumberingScheme
}

// Petit helper local pour garder les 17 rangées lisibles.
const row = (
  label: string,
  radius: number,
  side: number, // sièges par arc latéral
  centre: number, // sièges de l'arc central
  opts: { removableSides?: boolean } = {},
): RowConfig => ({
  label,
  radius,
  arcs: [
    { section: 'gauche', angleStart: -42, angleEnd: -16, seats: side, removable: opts.removableSides },
    { section: 'centre', angleStart: -13, angleEnd: 13, seats: centre },
    { section: 'droite', angleStart: 16, angleEnd: 42, seats: side, removable: opts.removableSides },
  ],
})

// [À CALIBRER] 17 rangées A→Q, 600 places :
//   A-D : 8+12+8 = 28 ×4 = 112
//   E-H : 10+14+10 = 34 ×4 = 136
//   I-L : 11+16+11 = 38 ×4 = 152
//   M-Q : 12+16+12 = 40 ×5 = 200
// Les arcs latéraux des deux derniers rangs (P, Q) sont marqués amovibles.
export const venueConfig: VenueConfig = {
  center: { x: 1500, y: 2400 },
  numberingScheme: 'continu',
  rows: [
    row('A', 800, 8, 12),
    row('B', 885, 8, 12),
    row('C', 970, 8, 12),
    row('D', 1055, 8, 12),
    row('E', 1140, 10, 14),
    row('F', 1225, 10, 14),
    row('G', 1310, 10, 14),
    row('H', 1395, 10, 14),
    row('I', 1480, 11, 16),
    row('J', 1565, 11, 16),
    row('K', 1650, 11, 16),
    row('L', 1735, 11, 16),
    row('M', 1820, 12, 16),
    row('N', 1905, 12, 16),
    row('O', 1990, 12, 16),
    row('P', 2075, 12, 16, { removableSides: true }),
    row('Q', 2160, 12, 16, { removableSides: true }),
  ],
}
