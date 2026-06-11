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
//    amovible (« console salle à la demande »), ainsi que le bloc jardin de W ;
//  - fosse « collée à la scène » : 2 rangées entièrement amovibles  X, Y
//    (Y au plus près de la scène), 16 places chacune, transformables en
//    avant-scène.
//
// 25 rangées, 754 places dessinées (la fiche fait foi). Les « terrasses »
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
  // Numéro du siège de l'arc LE PLUS PROCHE de l'axe (pair-impair uniquement).
  // Permet les SAUTS de numérotation réels de la salle (ex. rang O : pairs du
  // milieu jusqu'à 12, puis l'extérieur reprend à 16 — pas de 14). Sans cette
  // valeur, la numérotation continue depuis l'arc précédent. Doit être de la
  // parité du côté (impair côté jardin, pair côté cour) ; interdit sur un arc
  // qui chevauche l'axe (le centre).
  firstNumber?: number
  // Plusieurs arcs d'une MÊME section dans un rang (console partielle,
  // strapontins…) : par défaut ils sont SÉPARÉS (un trou d'indexInRow casse
  // la contiguïté du placement — personne n'est assis « à cheval »). À true,
  // l'arc est physiquement CONTIGU au précédent arc de sa section (les
  // fauteuils se touchent : console amovible posée au milieu d'un rang).
  contiguousWithPrevious?: boolean
}

export type RowConfig = {
  label: string // lettrage réel : A = rang le plus AU FOND, Y = collé à la scène
  radius: number
  arcs: ArcConfig[]
  // Décalage latéral PUREMENT VISUEL (px, positif = vers cour) : aligne le
  // dessin d'un rang excentré sans toucher aux angles — la numérotation
  // pair-impair reste calée sur l'axe.
  xOffset?: number
}

export type NumberingScheme = 'continu' | 'pair-impair'

export type VenueConfig = {
  name?: string // nom de la salle (affichage admin / fichiers multi-salles)
  center: { x: number; y: number } // point de convergence (derrière la scène)
  rows: RowConfig[]
  // 'continu'    : 1..N de jardin à cour sur toute la rangée
  // 'pair-impair': face à la scène, impairs côté jardin (gauche vu du
  //                public), pairs côté cour, croissants du centre
  numberingScheme: NumberingScheme
}

// Arc du CENTRE (les petits numéros) : `nNeg` sièges côté jardin (impairs
// 1,3,…) et `nPos` côté cour (pairs 2,4,…). L'arc est positionné pour que
// EXACTEMENT nNeg sièges tombent à angle < 0 — la frontière impair/pair est
// sur l'axe (les flags 1 / 12 de place.md ne décalent la géométrie que d'un
// demi-siège, pas la numérotation : ignorés).
const centreArc = (nNeg: number, nPos: number, pitch: number, removable = false): ArcConfig => {
  const n = nNeg + nPos
  const start = -(nNeg - 0.5) * pitch
  return {
    section: 'centre',
    angleStart: start,
    angleEnd: start + (n - 1) * pitch,
    seats: n,
    ...(removable ? { removable: true } : {}),
  }
}

// Rangée de fosse (X, Y) : un SEUL arc central, entièrement amovible —
// 8 impairs + 8 pairs (place.md : « (1/15) (2/16) »), pas de blocs latéraux.
const fosseRow = (label: string, radius: number): RowConfig => ({
  label,
  radius,
  arcs: [centreArc(8, 8, 1.2, true)],
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
  opts: {
    centreAmovible?: boolean
    jardinAmovible?: boolean
    // Sauts de numérotation réels (place.md) : premier numéro des blocs
    // extérieurs quand il ne suit pas le milieu (ex. O : pairs 12 puis 16).
    extImpairDe?: number
    extPairDe?: number
  } = {},
): RowConfig => ({
  label,
  radius,
  arcs: [
    {
      section: 'gauche',
      angleStart: outerL,
      angleEnd: -7.7,
      seats: g,
      ...(opts.jardinAmovible ? { removable: true } : {}),
      ...(opts.extImpairDe !== undefined ? { firstNumber: opts.extImpairDe } : {}),
    },
    centreArc(nNeg, nPos, PITCH_MILIEU, opts.centreAmovible ?? false),
    {
      section: 'droite',
      angleStart: 9.3,
      angleEnd: outerR,
      seats: d,
      ...(opts.extPairDe !== undefined ? { firstNumber: opts.extPairDe } : {}),
    },
  ],
})

// Rangées H et I : « console salle à la demande » — seuls les 8 sièges
// CENTRAUX (impairs 1→7, pairs 2→8) sont amovibles, le reste du centre est
// fixe. Le centre est scindé en 4 sous-arcs CONTIGUS (les fauteuils se
// touchent : indexInRow continue, le placement peut enjamber) ; les ids de
// sièges restent ceux de l'ancien arc unique.
const milieuRowConsole = (
  label: string,
  radius: number,
  outerL: number,
  g: number,
  d: number,
  outerR: number,
): RowConfig => {
  const p = PITCH_MILIEU
  return {
    label,
    radius,
    arcs: [
      { section: 'gauche', angleStart: outerL, angleEnd: -7.7, seats: g },
      { section: 'centre', angleStart: -7.5 * p, angleEnd: -4.5 * p, seats: 4 },
      { section: 'centre', angleStart: -3.5 * p, angleEnd: -0.5 * p, seats: 4, removable: true, contiguousWithPrevious: true },
      { section: 'centre', angleStart: 0.5 * p, angleEnd: 3.5 * p, seats: 4, removable: true, contiguousWithPrevious: true },
      { section: 'centre', angleStart: 4.5 * p, angleEnd: 7.5 * p, seats: 4, contiguousWithPrevious: true },
      { section: 'droite', angleStart: 9.3, angleEnd: outerR, seats: d },
    ],
  }
}

// Bloc du fond (« haute ») : bords et allées constants, centre nNeg/nPos.
const hauteRow = (
  label: string,
  radius: number,
  g: number,
  nNeg: number,
  nPos: number,
  d: number,
): RowConfig => ({
  label,
  radius,
  arcs: [
    { section: 'gauche', angleStart: -14.8, angleEnd: -6.6, seats: g },
    centreArc(nNeg, nPos, 0.8),
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
  name: 'Centre Culturel de Bergerac',
  center: { x: 716, y: 2520 }, // px scan — convergence des arcs
  numberingScheme: 'pair-impair',
  // Ordre du tableau : SCÈNE → FOND. rowOrder 0 = Y (le plus près de la scène).
  // Comptes calés sur place.md (relevé fiche, finalisé 2026-06-11).
  // Args milieuRow : label, radius, bordL, extImpair(g), milieuImpair(nNeg),
  // milieuPair(nPos), extPair(d), bordR. hauteRow : label, radius, g, nNeg, nPos, d.
  rows: [
    // Fosse « collée à la scène » — 16 places amovibles chacune (1→15 / 2→16)
    fosseRow('Y', 866),
    fosseRow('X', 910),
    // Bloc « normale » (milieu) — 16 rangées W → H, de la scène vers l'allée.
    milieuRow('W', 988, -19.3, 6, 5, 5, 6, 20.6, { jardinAmovible: true }), // (21/11) : terrasse jardin amovible
    milieuRow('V', 1046, -19.1, 7, 6, 5, 6, 20.4),
    milieuRow('U', 1086, -18.9, 7, 6, 5, 7, 20.1),
    milieuRow('T', 1126, -18.7, 7, 6, 5, 7, 19.9, { extImpairDe: 15, extPairDe: 14 }), // sauts : 13 et 12 n'existent pas
    milieuRow('S', 1166, -18.5, 8, 6, 6, 7, 19.7),
    milieuRow('R', 1208, -18.3, 7, 6, 6, 7, 19.4, { extImpairDe: 15, extPairDe: 16 }), // sauts : 13 et 14 n'existent pas
    milieuRow('Q', 1252, -18.1, 8, 7, 6, 8, 19.2),
    milieuRow('P', 1285, -16.95, 8, 7, 6, 8, 15.5),
    milieuRow('O', 1318, -17.8, 8, 7, 6, 8, 19.0, { extImpairDe: 17, extPairDe: 16 }), // sauts : 15 et 14 n'existent pas
    milieuRow('N', 1376, -17.6, 8, 7, 7, 8, 18.8),
    milieuRow('M', 1416, -17.4, 9, 7, 7, 9, 18.5, { extImpairDe: 17 }), // saut : 15 n'existe pas
    milieuRow('L', 1456, -17.2, 9, 8, 7, 9, 18.3),
    milieuRow('K', 1498, -17.0, 9, 8, 7, 9, 18.1),
    milieuRow('J', 1531, -17.6, 10, 8, 7, 10, 17.0),
    // « Console salle à la demande » : 8 sièges centraux amovibles, EXACT.
    milieuRowConsole('I', 1565, -16.8, 10, 10, 17.8),
    milieuRowConsole('H', 1608, -16.6, 10, 10, 17.6),
    // Allée transversale, puis bloc « haute » (fond, 7 rangées G → A)
    hauteRow('G', 1704, 8, 8, 7, 8), // impairs 1→31, pairs 2→30
    hauteRow('F', 1760, 9, 8, 7, 9), // impairs 1→33, pairs 2→32
    hauteRow('E', 1800, 9, 8, 8, 9), // impairs 1→33, pairs 2→34
    hauteRow('D', 1842, 9, 8, 8, 9), // impairs 1→33, pairs 2→34
    hauteRow('C', 1884, 9, 9, 9, 9), // impairs 1→35, pairs 2→36
    hauteRow('B', 1926, 10, 9, 9, 10), // impairs 1→37, pairs 2→38
    fullRow('A', 1974, -15.5, 15.4, 45), // rang continu (pas d'allées) : impairs 1→45, pairs 2→44
  ],
}
