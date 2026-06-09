// Configuration paramétrique de la salle — Centre Culturel de Bergerac.
//
// Salle en éventail : rangées en arcs de cercle concentriques, 3 sections
// (gauche / centre / droite) séparées par des allées. Tout le plan (seed,
// rendu SVG, calibration) est généré depuis ce fichier — RIEN n'est hardcodé.
//
// CALIBRÉ le 2026-06-10 par analyse du scan de la fiche technique
// (public/plan-scan.png, version nettoyée 1848×2612) : détection du centre
// de convergence par optimisation du profil radial, rayons des rangées =
// pics du profil, allées + nombre de sièges par segment = profils angulaires
// (pas de siège mesuré ≈ 24 px). Les UNITÉS sont les PIXELS du scan :
// l'overlay de /admin/calibration s'aligne donc presque sans réglage.
//
// Structure relevée (23 rangées, 783 places dessinées — la fiche fait foi,
// les « ~600 » annoncés étaient une approximation) :
//  - fosse d'orchestre : 2 rangées amovibles (AA, BB) transformables en
//    avant-scène, + 2 petits blocs latéraux fixes de 4 sièges ;
//  - bloc avant : 14 rangées A→N ; le segment CENTRE des rangées M et N est
//    amovible (hachuré sur la fiche : « console salle à la demande ») ;
//  - allée transversale, puis bloc arrière : 7 rangées O→U.
//  - les « terrasses » latérales le long des murs ne sont pas des sièges
//    numérotés sur la fiche : non modélisées.
//
// Conventions :
//  - angles en degrés, 0 = axe central, négatif = côté jardin (gauche vu du
//    public), positif = côté cour ;
//  - radius en px scan depuis `center` (convergence, derrière la scène —
//    la scène est en BAS du plan, les rangs s'éloignent vers le haut) ;
//  - x = cx + r·sin(θ), y = cy − r·cos(θ) ;
//  - `seats` est un nombre EXPLICITE par arc : les salles réelles sont
//    irrégulières, on ne déduit jamais le nombre de sièges de la géométrie.

export type SectionId = 'gauche' | 'centre' | 'droite'

export type ArcConfig = {
  section: SectionId
  angleStart: number // degrés, bord jardin de l'arc
  angleEnd: number // degrés, bord cour de l'arc
  seats: number
  removable?: boolean // sièges amovibles (fosse, console)
}

export type RowConfig = {
  label: string // A = rang le plus proche de la scène (AA/BB = fosse)
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

// Rangée de fosse : centre amovible + mini-blocs latéraux fixes (3×3 sur la
// fiche, modélisés 3×2 — approximation assumée sur ces strapontins).
const fosseRow = (label: string, radius: number, centreSeats: number): RowConfig => ({
  label,
  radius,
  arcs: [
    { section: 'gauche', angleStart: -18.8, angleEnd: -13.7, seats: 3 },
    { section: 'centre', angleStart: -11.0, angleEnd: 12.9, seats: centreSeats, removable: true },
    { section: 'droite', angleStart: 15.2, angleEnd: 20.5, seats: 3 },
  ],
})

// Bloc avant : les murs convergent légèrement → bords extérieurs par rangée.
const frontRow = (
  label: string,
  radius: number,
  outerL: number,
  g: number,
  c: number,
  d: number,
  outerR: number,
  centreRemovable = false,
): RowConfig => ({
  label,
  radius,
  arcs: [
    { section: 'gauche', angleStart: outerL, angleEnd: -7.7, seats: g },
    { section: 'centre', angleStart: -6.0, angleEnd: 7.6, seats: c, removable: centreRemovable || undefined },
    { section: 'droite', angleStart: 9.3, angleEnd: outerR, seats: d },
  ],
})

// Bloc arrière : bords et allées constants.
const rearRow = (label: string, radius: number, g: number, c: number, d: number): RowConfig => ({
  label,
  radius,
  arcs: [
    { section: 'gauche', angleStart: -14.8, angleEnd: -6.6, seats: g },
    { section: 'centre', angleStart: -5.4, angleEnd: 6.6, seats: c },
    { section: 'droite', angleStart: 7.9, angleEnd: 16.1, seats: d },
  ],
})

export const venueConfig: VenueConfig = {
  center: { x: 716, y: 2520 }, // px scan — convergence des arcs
  numberingScheme: 'continu',
  rows: [
    // Fosse d'orchestre — amovible, transformable en avant-scène
    fosseRow('AA', 866, 20),
    fosseRow('BB', 910, 20),
    // Bloc avant (14 rangées) — bord jardin rentré de 1.2° : sur la fiche,
    // le trait d'escalier longe le dernier fauteuil et faussait la mesure.
    frontRow('A', 988, -19.3, 8, 10, 8, 20.6),
    frontRow('B', 1046, -19.1, 9, 11, 8, 20.4),
    frontRow('C', 1086, -18.9, 9, 11, 9, 20.1),
    frontRow('D', 1126, -18.7, 9, 12, 9, 19.9),
    frontRow('E', 1166, -18.5, 9, 12, 9, 19.7),
    frontRow('F', 1208, -18.3, 9, 12, 9, 19.4),
    frontRow('G', 1252, -18.1, 10, 13, 9, 19.2),
    frontRow('H', 1318, -17.8, 10, 14, 9, 19.0),
    frontRow('I', 1376, -17.6, 10, 14, 10, 18.8),
    frontRow('J', 1416, -17.4, 10, 15, 9, 18.5),
    frontRow('K', 1456, -17.2, 10, 15, 10, 18.3),
    frontRow('L', 1498, -17.0, 10, 15, 10, 18.1),
    // « Console salle à la demande » : segment centre amovible (hachuré)
    frontRow('M', 1565, -16.8, 11, 16, 10, 17.8, true),
    frontRow('N', 1608, -16.6, 11, 17, 10, 17.6, true),
    // Allée transversale, puis bloc arrière (7 rangées)
    rearRow('O', 1704, 10, 16, 10),
    rearRow('P', 1760, 10, 16, 10),
    rearRow('Q', 1800, 11, 16, 11),
    rearRow('R', 1842, 11, 17, 11),
    rearRow('S', 1884, 11, 17, 11),
    rearRow('T', 1926, 11, 18, 11),
    rearRow('U', 1974, 12, 18, 12),
  ],
}
