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
// LETTRAGE RÉEL (corrigé le 2026-06-11, confirmé par Gautier) : la salle est
// numérotée A (tout AU FOND) → Y (collé à la SCÈNE), en 3 blocs :
//  - bloc « haute » (fond)   : 7 rangées  A → G  (A au fond, G côté allée) ;
//  - allée transversale ;
//  - bloc « normale » (milieu) : 16 rangées H → W  (H côté allée, W vers la
//    scène) ; le segment CENTRE des 2 rangées du fond du bloc (H, I) est
//    amovible (hachuré sur la fiche : « console salle à la demande ») ;
//  - fosse « collée à la scène » : 2 rangées amovibles  X, Y  (Y au plus près
//    de la scène), transformables en avant-scène, + 2 petits blocs latéraux
//    fixes de 3 sièges chacun.
//
// 25 rangées, 809 places dessinées (la fiche fait foi). Les « terrasses »
// latérales le long des murs ne sont pas des sièges numérotés : non modélisées.
//
// ⚠️ Le tableau `rows` est ordonné de la SCÈNE vers le FOND (rowOrder 0 = Y,
// rangée la plus proche de la scène). Le lettrage décroît donc Y → A dans
// l'ordre du tableau. Ne pas réordonner sans comprendre que `rowOrder` (issu
// de l'index du tableau) pilote le score statique.
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
  label: string // lettrage réel : A = rang le plus AU FOND, Y = collé à la scène
  radius: number
  arcs: ArcConfig[]
}

export type NumberingScheme = 'continu' | 'pair-impair'

export type VenueConfig = {
  center: { x: number; y: number } // point de convergence (derrière la scène)
  rows: RowConfig[]
  // 'continu'    : 1..N de jardin à cour sur toute la rangée
  // 'pair-impair': face à la scène, impairs à droite (cour), pairs à
  //                gauche (jardin), croissants du centre — confirmé 2026-06-10
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

// Bloc « normale » (milieu) : exterior jardin (g) + centre + exterior cour (d).
// Le centre porte les PETITS numéros (milieu) : `nNeg` sièges côté jardin
// (impairs 1,3,…), `nPos` côté cour (pairs 2,4,…). L'arc du centre est
// positionné (PITCH ≈ largeur d'un siège) pour que EXACTEMENT `nNeg` sièges
// tombent à angle < 0. g/d/nNeg/nPos calés sur place.md (fiche). Les « sauts »
// de numérotation réels de la salle (un siège manquant ici ou là) ne sont PAS
// encore reproduits — à affiner. centreRemovable approxime la console (H/I).
const PITCH_MILIEU = 0.95
const milieuRow = (
  label: string,
  radius: number,
  outerL: number,
  g: number,
  nNeg: number,
  nPos: number,
  d: number,
  outerR: number,
  centreRemovable = false,
): RowConfig => {
  const n = nNeg + nPos
  const cStart = -(nNeg - 0.5) * PITCH_MILIEU
  return {
    label,
    radius,
    arcs: [
      { section: 'gauche', angleStart: outerL, angleEnd: -7.7, seats: g },
      {
        section: 'centre',
        angleStart: cStart,
        angleEnd: cStart + (n - 1) * PITCH_MILIEU,
        seats: n,
        removable: centreRemovable || undefined,
      },
      { section: 'droite', angleStart: 9.3, angleEnd: outerR, seats: d },
    ],
  }
}

// Bloc du fond (« haute ») : bords et allées constants. Centre SYMÉTRIQUE
// (split pair/impair égal) — le milieu est numéroté 1→… / 2→… puis les blocs
// extérieurs continuent (g = sièges extérieurs jardin, d = extérieurs cour).
const rearRow = (label: string, radius: number, g: number, c: number, d: number): RowConfig => ({
  label,
  radius,
  arcs: [
    { section: 'gauche', angleStart: -14.8, angleEnd: -6.6, seats: g },
    { section: 'centre', angleStart: -6.0, angleEnd: 6.0, seats: c },
    { section: 'droite', angleStart: 7.9, angleEnd: 16.1, seats: d },
  ],
})

// Rangée CONTINUE : un seul arc plein largeur, sans allées (un seul `rowId`,
// donc contigu de bout en bout). Le rang A (tout au fond) n'est pas coupé par
// les escaliers. Numérotation pair-impair depuis l'axe, comme les autres.
const fullRow = (label: string, radius: number, angleStart: number, angleEnd: number, seats: number): RowConfig => ({
  label,
  radius,
  arcs: [{ section: 'centre', angleStart, angleEnd, seats }],
})

export const venueConfig: VenueConfig = {
  center: { x: 716, y: 2520 }, // px scan — convergence des arcs
  numberingScheme: 'pair-impair',
  // Ordre du tableau : SCÈNE → FOND. rowOrder 0 = Y (le plus près de la scène).
  rows: [
    // Fosse « collée à la scène » — amovible, transformable en avant-scène
    fosseRow('Y', 866, 20),
    fosseRow('X', 910, 20),
    // Bloc « normale » (milieu) — 16 rangées W → H, de la scène vers l'allée.
    // Comptes calés sur place.md / fiche (2026-06-11). Args : label, radius,
    // bordL, extImpair(g), milieuImpair(nNeg), milieuPair(nPos), extPair(d), bordR.
    milieuRow('W', 988, -19.3, 8, 4, 6, 8, 20.6),
    milieuRow('V', 1046, -19.1, 9, 5, 6, 8, 20.4),
    milieuRow('U', 1086, -18.9, 9, 5, 6, 9, 20.1),
    milieuRow('T', 1126, -18.7, 9, 5, 7, 9, 19.9),
    milieuRow('S', 1166, -18.5, 9, 5, 7, 9, 19.7),
    milieuRow('R', 1208, -18.3, 9, 5, 7, 9, 19.4),
    milieuRow('Q', 1252, -18.1, 10, 6, 7, 9, 19.2),
    milieuRow('P', 1285, -16.95, 9, 6, 8, 6, 15.5),
    milieuRow('O', 1318, -17.8, 10, 6, 8, 9, 19.0),
    milieuRow('N', 1376, -17.6, 10, 6, 8, 10, 18.8),
    milieuRow('M', 1416, -17.4, 9, 7, 7, 9, 18.5),
    milieuRow('L', 1456, -17.2, 9, 8, 7, 9, 18.3),
    milieuRow('K', 1498, -17.0, 9, 8, 7, 9, 18.1),
    milieuRow('J', 1531, -17.6, 10, 8, 7, 10, 17.0),
    // « Console salle à la demande » : centre amovible (hachuré sur la fiche)
    // sur H et I. Approx : tout le centre marqué amovible (en vrai seuls les
    // 8 sièges centraux le sont — à affiner).
    milieuRow('I', 1565, -16.8, 10, 8, 8, 10, 17.8, true),
    milieuRow('H', 1608, -16.6, 10, 8, 8, 10, 17.6, true),
    // Allée transversale, puis bloc « haute » (fond, 7 rangées G → A)
    rearRow('G', 1704, 8, 16, 7), // impairs 1→31, pairs 2→30
    rearRow('F', 1760, 9, 16, 8), // impairs 1→33, pairs 2→32
    rearRow('E', 1800, 9, 16, 9), // impairs 1→33, pairs 2→34
    rearRow('D', 1842, 9, 16, 9), // impairs 1→33, pairs 2→34
    rearRow('C', 1884, 9, 18, 9), // impairs 1→35, pairs 2→36
    rearRow('B', 1926, 10, 18, 10), // impairs 1→37, pairs 2→38
    fullRow('A', 1974, -15.5, 15.4, 45), // rang continu (pas d'allées) : impairs 1→45, pairs 2→44
  ],
}
