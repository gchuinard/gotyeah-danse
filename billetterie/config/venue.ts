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

// ── Géométrie en UNITÉS LINÉAIRES (px du scan) ───────────────────────────
//
// Tout pas/allée est défini en PIXELS (largeur réelle constante), JAMAIS en
// angle constant : un angle constant dilate le fond de la salle, car la
// largeur réelle = angle × rayon. L'angle se déduit donc du rayon de chaque
// rangée : angleParSiège = SEAT_PITCH / rayon (rad).
//
// Ce sont LES boutons de calibration — à ajuster à l'œil sur le scan via
// /admin/calibration (l'overlay « Allées » trace les axes AISLE_AXES).
const SEAT_PITCH = 22 // entraxe d'un fauteuil + accoudoir (px scan)
const AISLE_WIDTH = 40 // largeur d'une allée verticale (px scan)
// Axes RADIAUX des deux allées (degrés depuis l'axe central, < 0 = jardin).
// MÊMES axes pour le fond et le milieu → allées alignées sur toute la
// profondeur, puisqu'elles convergent vers le même `center`. La zone du fond
// « ouvre » alors automatiquement moins (même demi-largeur linéaire, rayon
// plus grand ⇒ angle plus petit) : plus de bornes de murs codées en dur.
export const AISLE_AXES = { jardin: -7.5, cour: 8.5 }

const degParPx = (radius: number) => 180 / (Math.PI * radius)
const pitchDeg = (radius: number) => SEAT_PITCH * degParPx(radius)
const demiAllee = (radius: number) => (AISLE_WIDTH / 2) * degParPx(radius)

// Arc du CENTRE (les petits numéros) : `nNeg` sièges côté jardin (impairs
// 1,3,…) et `nPos` côté cour (pairs 2,4,…), au pas LINÉAIRE à ce rayon.
// EXACTEMENT nNeg sièges tombent à angle < 0 — la frontière impair/pair est
// sur l'axe (les flags 1 / 12 de place.md ne décalent la géométrie que d'un
// demi-siège, pas la numérotation : ignorés).
const centreArc = (nNeg: number, nPos: number, radius: number, removable = false): ArcConfig => {
  const p = pitchDeg(radius)
  const n = nNeg + nPos
  const start = -(nNeg - 0.5) * p
  return {
    section: 'centre',
    angleStart: start,
    angleEnd: start + (n - 1) * p,
    seats: n,
    ...(removable ? { removable: true } : {}),
  }
}

// Bloc latéral (gauche = jardin / droite = cour) : posé À PARTIR de l'axe
// d'allée vers le mur, au pas linéaire. Le bord intérieur (près de l'allée)
// est sur l'axe radial ± la demi-allée → l'allée est une vraie ligne radiale,
// alignée d'un rang à l'autre. Le bord extérieur se déduit du nombre de
// sièges : pas de mur codé en dur, la largeur réelle reste constante.
const blocLateral = (
  section: 'gauche' | 'droite',
  seats: number,
  radius: number,
  opts: { removable?: boolean; firstNumber?: number } = {},
): ArcConfig => {
  const p = pitchDeg(radius)
  const g = demiAllee(radius)
  const flags = {
    ...(opts.removable ? { removable: true } : {}),
    ...(opts.firstNumber !== undefined ? { firstNumber: opts.firstNumber } : {}),
  }
  if (section === 'gauche') {
    const inner = AISLE_AXES.jardin - g // bord près de l'allée (le moins négatif)
    return { section, angleStart: inner - (seats - 1) * p, angleEnd: inner, seats, ...flags }
  }
  const inner = AISLE_AXES.cour + g
  return { section, angleStart: inner, angleEnd: inner + (seats - 1) * p, seats, ...flags }
}

// Rangée de fosse (X, Y) : un SEUL arc central, entièrement amovible —
// 8 impairs + 8 pairs (place.md : « (1/15) (2/16) »), pas de blocs latéraux.
const fosseRow = (label: string, radius: number): RowConfig => ({
  label,
  radius,
  arcs: [centreArc(8, 8, radius, true)],
})

// Bloc « normale » (milieu) : extérieur jardin (g) + centre (nNeg/nPos) +
// extérieur cour (d). Le centre porte les PETITS numéros. g/d/nNeg/nPos calés
// sur place.md (fiche). Les « sauts » de numérotation réels (un siège manquant
// ici ou là) passent par extImpairDe / extPairDe (firstNumber des blocs ext.).
const milieuRow = (
  label: string,
  radius: number,
  g: number,
  nNeg: number,
  nPos: number,
  d: number,
  opts: {
    jardinAmovible?: boolean
    extImpairDe?: number
    extPairDe?: number
  } = {},
): RowConfig => ({
  label,
  radius,
  arcs: [
    blocLateral('gauche', g, radius, {
      removable: opts.jardinAmovible,
      firstNumber: opts.extImpairDe,
    }),
    centreArc(nNeg, nPos, radius),
    blocLateral('droite', d, radius, { firstNumber: opts.extPairDe }),
  ],
})

// Rangées H et I : « console salle à la demande » — seuls les 8 sièges
// CENTRAUX (impairs 1→7, pairs 2→8) sont amovibles, le reste du centre est
// fixe. Le centre est scindé en 4 sous-arcs CONTIGUS (les fauteuils se
// touchent : indexInRow continue, le placement peut enjamber) ; les ids de
// sièges restent ceux de l'ancien arc unique.
const milieuRowConsole = (label: string, radius: number, g: number, d: number): RowConfig => {
  const p = pitchDeg(radius)
  // 16 sièges centraux, en 4 sous-arcs CONTIGUS centrés sur l'axe : −7.5p …
  // +7.5p. Le 1er n'est pas « contigu » (il ouvre la section centre).
  const sousArc = (depuis: number, opts: { removable?: boolean; contigu?: boolean } = {}): ArcConfig => ({
    section: 'centre',
    angleStart: depuis * p,
    angleEnd: (depuis + 3) * p,
    seats: 4,
    ...(opts.removable ? { removable: true } : {}),
    ...(opts.contigu ? { contiguousWithPrevious: true } : {}),
  })
  return {
    label,
    radius,
    arcs: [
      blocLateral('gauche', g, radius),
      sousArc(-7.5),
      sousArc(-3.5, { removable: true, contigu: true }),
      sousArc(0.5, { removable: true, contigu: true }),
      sousArc(4.5, { contigu: true }),
      blocLateral('droite', d, radius),
    ],
  }
}

// Bloc du fond (« haute ») : mêmes allées radiales que le milieu, centre
// nNeg/nPos au pas linéaire — donc une demi-largeur réelle constante avec le
// reste de la salle (le fond n'ouvre plus exagérément).
const hauteRow = (label: string, radius: number, g: number, nNeg: number, nPos: number, d: number): RowConfig => ({
  label,
  radius,
  arcs: [blocLateral('gauche', g, radius), centreArc(nNeg, nPos, radius), blocLateral('droite', d, radius)],
})

// Rangée CONTINUE : un seul arc central plein largeur, sans allées (un seul
// `rowId`, donc contigu de bout en bout). Le rang A (tout au fond) n'est pas
// coupé par les escaliers. Numérotation pair-impair depuis l'axe.
const rangContinu = (label: string, radius: number, nNeg: number, nPos: number): RowConfig => ({
  label,
  radius,
  arcs: [centreArc(nNeg, nPos, radius)],
})

export const venueConfig: VenueConfig = {
  name: 'Centre Culturel de Bergerac',
  center: { x: 716, y: 2520 }, // px scan — convergence des arcs
  numberingScheme: 'pair-impair',
  // Ordre du tableau : SCÈNE → FOND. rowOrder 0 = Y (le plus près de la scène).
  // Comptes calés sur place.md (relevé fiche, finalisé 2026-06-11). Les rayons
  // (calibrés sur le profil radial du scan) restent figés ; SEULS les angles
  // sont désormais calculés (pas/allées linéaires) — voir AISLE_AXES ci-dessus.
  // Args milieuRow : label, radius, extImpair(g), milieuImpair(nNeg),
  // milieuPair(nPos), extPair(d). hauteRow : label, radius, g, nNeg, nPos, d.
  rows: [
    // Fosse « collée à la scène » — 16 places amovibles chacune (1→15 / 2→16)
    fosseRow('Y', 866),
    fosseRow('X', 910),
    // Bloc « normale » (milieu) — 16 rangées W → H, de la scène vers l'allée.
    milieuRow('W', 988, 6, 5, 5, 6, { jardinAmovible: true }), // (21/11) : terrasse jardin amovible
    milieuRow('V', 1046, 7, 6, 5, 6),
    milieuRow('U', 1086, 7, 6, 5, 7),
    milieuRow('T', 1126, 7, 6, 5, 7, { extImpairDe: 15, extPairDe: 14 }), // sauts : 13 et 12 n'existent pas
    milieuRow('S', 1166, 8, 6, 6, 7),
    milieuRow('R', 1208, 7, 6, 6, 7, { extImpairDe: 15, extPairDe: 16 }), // sauts : 13 et 14 n'existent pas
    milieuRow('Q', 1252, 8, 7, 6, 8),
    milieuRow('P', 1285, 8, 7, 6, 8),
    milieuRow('O', 1318, 8, 7, 6, 8, { extImpairDe: 17, extPairDe: 16 }), // sauts : 15 et 14 n'existent pas
    milieuRow('N', 1376, 8, 7, 7, 8),
    milieuRow('M', 1416, 9, 7, 7, 9, { extImpairDe: 17 }), // saut : 15 n'existe pas
    milieuRow('L', 1456, 9, 8, 7, 9),
    milieuRow('K', 1498, 9, 8, 7, 9),
    milieuRow('J', 1531, 10, 8, 7, 10),
    // « Console salle à la demande » : 8 sièges centraux amovibles, EXACT.
    milieuRowConsole('I', 1565, 10, 10),
    milieuRowConsole('H', 1608, 10, 10),
    // Allée transversale, puis bloc « haute » (fond, 7 rangées G → A)
    hauteRow('G', 1704, 8, 8, 7, 8), // impairs 1→31, pairs 2→30
    hauteRow('F', 1760, 9, 8, 7, 9), // impairs 1→33, pairs 2→32
    hauteRow('E', 1800, 9, 8, 8, 9), // impairs 1→33, pairs 2→34
    hauteRow('D', 1842, 9, 8, 8, 9), // impairs 1→33, pairs 2→34
    hauteRow('C', 1884, 9, 9, 9, 9), // impairs 1→35, pairs 2→36
    hauteRow('B', 1926, 10, 9, 9, 10), // impairs 1→37, pairs 2→38
    rangContinu('A', 1974, 23, 22), // rang continu (pas d'allées) : impairs 1→45, pairs 2→44
  ],
}
