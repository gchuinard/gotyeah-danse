// Moteur de placement « intelligent » — voir PLACEMENT.md.
//
// Deux familles de candidats, on garde les 3 meilleurs (et DIVERS) :
//  - FENÊTRES : `partySize` sièges contigus sur UNE rangée (cas idéal) ;
//  - BLOCS : le groupe réparti sur K rangées ADJACENTES de la même section
//    (rowOrder consécutifs), chaque rangée contiguë, toutes alignées sur la
//    même colonne de départ → un bloc vertical d'un seul tenant (les uns
//    devant les autres). Ex. 6 = 3+3 sur 2 rangs, 15 = 5+5+5 sur 3 rangs.
//
// QUALITÉ — tout est ramené au SCORE MOYEN PAR SIÈGE (0-100), pour que le
// confort et les pénalités soient à la même échelle quelle que soit la taille
// du groupe (sinon l'anti-orphelin, absolu, devient négligeable face à la
// SOMME des scores d'un gros groupe). On retranche :
//   - le malus des « restes » (morceaux de run laissés à côté ; un siège seul
//     est quasi invendable — PLACEMENT.md §3) ;
//   - une pénalité de FRAGMENTATION : couper le milieu d'un grand run (deux
//     restes non vides) gâche une rangée rare, même sans créer d'orphelin ;
//   - pour les blocs : un coût par rangée supplémentaire + un malus si une
//     rangée ne reçoit qu'UN siège (esseulé devant/derrière) ; l'anti-orphelin
//     y est pondéré plus faiblement (POIDS_ORPHELIN_BLOC) — un bloc de secours
//     privilégie le confort de la famille à la chasse aux miettes ;
//   - une retenue de ZONE : tant que la salle se remplit, on déprécie les
//     mauvaises places (fosse / bords) pour ne pas les distribuer trop tôt.
//
// SÉLECTION — priorité absolue à la MÊME RANGÉE. On propose d'abord des
// FENÊTRES (le groupe entier sur une seule rangée), sur des rangées DISTINCTES
// pour offrir un vrai choix (rangée X / Y / Z plutôt que la même décalée). Les
// BLOCS (remplissage vertical sur 2+ rangs) ne viennent qu'« LE CAS ÉCHÉANT » :
// pour compléter quand il n'y a pas assez de fenêtres distinctes, ou quand le
// groupe ne tient sur aucune rangée. On ne retrie jamais par qualité après coup
// (sinon un bloc mieux noté repasserait devant une fenêtre — ce qu'on refuse).
//
// Fonction PURE et déterministe (on reconstruit l'ordre d'entrée, aucun
// Math.random ni horloge ; départage par ids triés).

import type { PlacementFn, SeatState, Suggestion } from './types'

export const implemented = true

// Au-delà, un « bloc » deviendrait une colonne trop haute et étroite : on
// préfère renvoyer vide (placement manuel) qu'une suggestion absurde.
const MAX_RANGEES_BLOC = 8

// Tous les curseurs ci-dessous sont en POINTS DE SCORE MOYEN (échelle 0-100).
const FRAG_CAP = 6 // pénalité max pour avoir scindé le milieu d'un run
const MALUS_RANGEE_SUP = 6 // par rangée d'un bloc au-delà de la première
const MALUS_PETIT_MORCEAU = 15 // une rangée du bloc ne reçoit qu'un seul siège
// Un bloc est un REMPLISSAGE de secours : on y pondère l'anti-orphelin plus
// faiblement que pour une fenêtre, pour PRIVILÉGIER LE CONFORT de la famille
// placée (de bonnes places) quitte à laisser un siège isolé. 0 = confort pur ;
// 1 = anti-orphelin plein (comme les fenêtres). À 0,5 : il faut un gain de
// confort > ~15 pts pour accepter d'éparpiller un siège.
const POIDS_ORPHELIN_BLOC = 0.5
const ZONE_PIVOT = 45 // en-dessous de ce score moyen, place « médiocre »
const ZONE_W = 0.5 // poids de la retenue de zone (s'efface quand la salle se remplit)

// Malus d'un reste de run (PLACEMENT.md §3) : un siège seul est quasi
// invendable, un reste de 4+ reste pleinement exploitable.
function malusReste(n: number): number {
  if (n <= 0) return 0
  if (n === 1) return 30
  if (n === 2) return 8
  if (n === 3) return 3
  return 0
}

// Couper le MILIEU d'un run (un reste non vide de chaque côté) fragmente une
// rangée même quand aucun reste n'est pénalisé (deux restes ≥ 4). On nudge donc
// vers les BORDS : plus le plus petit reste est gros, plus on a bisecté un run
// long → plus c'est cher (plafonné). Un placement en bord (un reste nul) = 0.
function malusFragmentation(gauche: number, droite: number): number {
  if (gauche <= 0 || droite <= 0) return 0
  return Math.min(FRAG_CAP, Math.min(gauche, droite))
}

// Retenue de zone : tant que la salle n'est pas pleine (occ → 0), on déprécie
// les suggestions à faible score moyen (fosse, bords) pour les garder pour plus
// tard. À salle pleine (occ → 1), la retenue disparaît.
function malusZone(scoreMoyen: number, occupation: number): number {
  return (1 - occupation) * Math.max(0, ZONE_PIVOT - scoreMoyen) * ZONE_W
}

type Run = {
  rowId: string
  section: string
  rowOrder: number
  seats: SeatState[] // libres, indexInRow consécutifs croissants
  base: number // indexInRow du premier siège du run
  prefix: number[] // prefix[k] = somme des scores des k premiers sièges
}

type Candidat = {
  seats: SeatState[]
  qualite: number
  type: 'fenetre' | 'bloc'
  section: string
  rowOrder: number // rang le plus proche de la scène occupé par le candidat
}
type Intervalle = [number, number] // bornes incluses

function construireRuns(seats: SeatState[]): Run[] {
  const parRangee = new Map<string, SeatState[]>()
  for (const s of seats) {
    if (!s.free) continue
    const liste = parRangee.get(s.rowId)
    if (liste) liste.push(s)
    else parRangee.set(s.rowId, [s])
  }

  const runs: Run[] = []
  for (const liste of parRangee.values()) {
    liste.sort((a, b) => a.indexInRow - b.indexInRow)
    let i = 0
    while (i < liste.length) {
      let j = i + 1
      while (j < liste.length && liste[j].indexInRow === liste[j - 1].indexInRow + 1) j++
      const seg = liste.slice(i, j)
      const prefix = [0]
      for (const s of seg) prefix.push(prefix[prefix.length - 1] + s.score)
      runs.push({
        rowId: seg[0].rowId,
        section: seg[0].section,
        rowOrder: seg[0].rowOrder,
        seats: seg,
        base: seg[0].indexInRow,
        prefix,
      })
      i = j
    }
  }
  runs.sort((a, b) => a.rowOrder - b.rowOrder || a.rowId.localeCompare(b.rowId) || a.base - b.base)
  return runs
}

const sommeScore = (run: Run, p: number, k: number) => run.prefix[p + k] - run.prefix[p]

// Intersection de deux listes d'intervalles triés disjoints.
function intersecter(a: Intervalle[], b: Intervalle[]): Intervalle[] {
  const out: Intervalle[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0])
    const hi = Math.min(a[i][1], b[j][1])
    if (lo <= hi) out.push([lo, hi])
    if (a[i][1] < b[j][1]) i++
    else j++
  }
  return out
}

// Fenêtres mono-rangée de taille n.
function fenetres(run: Run, n: number, occupation: number, out: Candidat[]): void {
  const L = run.seats.length
  for (let p = 0; p + n <= L; p++) {
    const gauche = p
    const droite = L - (p + n)
    const scoreMoyen = sommeScore(run, p, n) / n
    const qualite =
      scoreMoyen -
      malusReste(gauche) -
      malusReste(droite) -
      malusFragmentation(gauche, droite) -
      malusZone(scoreMoyen, occupation)
    out.push({
      seats: run.seats.slice(p, p + n),
      qualite,
      type: 'fenetre',
      section: run.section,
      rowOrder: run.rowOrder,
    })
  }
}

// Meilleur bloc du groupe sur K rangées adjacentes (rangsRuns[i] = runs de la
// i-ème rangée). Répartition équilibrée, toutes les fenêtres démarrent à la
// même colonne c → bloc vertical d'un seul tenant.
function meilleurBloc(rangsRuns: Run[][], n: number, occupation: number, out: Candidat[]): void {
  const K = rangsRuns.length
  const base = Math.floor(n / K)
  if (base < 1) return // une rangée recevrait 0 siège : K trop grand pour n
  const extra = n % K
  const parts = rangsRuns.map((_, i) => base + (i < extra ? 1 : 0))
  // Une rangée n'accueillant qu'un seul siège laisse quelqu'un esseulé sur son
  // rang (devant/derrière les autres) — on le décourage sans l'interdire.
  const malusPetit = parts.some((p) => p === 1) ? MALUS_PETIT_MORCEAU : 0

  // Colonnes de départ valides pour CHAQUE rangée (union de ses runs), puis
  // intersection : une colonne c où toutes les rangées peuvent poser leur part.
  let inter: Intervalle[] | null = null
  for (let i = 0; i < K; i++) {
    const intervals: Intervalle[] = []
    for (const run of rangsRuns[i]) {
      const hi = run.base + run.seats.length - parts[i]
      if (hi >= run.base) intervals.push([run.base, hi])
    }
    if (intervals.length === 0) return
    inter = inter === null ? intervals : intersecter(inter, intervals)
    if (inter.length === 0) return
  }

  let best: Candidat | null = null
  for (const [lo, hi] of inter!) {
    for (let c = lo; c <= hi; c++) {
      const seats: SeatState[] = []
      let score = 0
      let restes = 0
      for (let i = 0; i < K; i++) {
        const run = rangsRuns[i].find(
          (r) => r.base <= c && r.base + r.seats.length >= c + parts[i],
        )!
        const p = c - run.base
        for (let k = 0; k < parts[i]; k++) seats.push(run.seats[p + k])
        score += sommeScore(run, p, parts[i])
        restes += malusReste(p) + malusReste(run.seats.length - (p + parts[i]))
      }
      const scoreMoyen = score / n
      const qualite =
        scoreMoyen -
        POIDS_ORPHELIN_BLOC * restes -
        malusPetit -
        MALUS_RANGEE_SUP * (K - 1) -
        malusZone(scoreMoyen, occupation)
      if (!best || qualite > best.qualite) {
        best = {
          seats,
          qualite,
          type: 'bloc',
          section: rangsRuns[0][0].section,
          rowOrder: Math.min(...rangsRuns.map((r) => r[0].rowOrder)),
        }
      }
    }
  }
  if (best) out.push(best)
}

export const suggestPlacement: PlacementFn = (seats, partySize) => {
  if (!Number.isInteger(partySize) || partySize < 1) return []

  // Taux d'occupation de la salle (sièges actifs) — pilote la retenue de zone.
  // Compté sur l'entrée brute : pur et indépendant de l'ordre.
  const total = seats.length
  const occupation = total > 0 ? seats.reduce((n, s) => n + (s.free ? 0 : 1), 0) / total : 0

  const runs = construireRuns(seats)
  const candidats: Candidat[] = []

  // Fenêtres mono-rangée.
  for (const run of runs) {
    if (run.seats.length >= partySize) fenetres(run, partySize, occupation, candidats)
  }

  // Blocs sur K rangées adjacentes (K ≥ 2) de la même section.
  if (partySize >= 2) {
    const runsParRang = new Map<string, Run[]>() // `${section}:${rowOrder}` → runs
    for (const r of runs) {
      const cle = `${r.section}:${r.rowOrder}`
      const liste = runsParRang.get(cle)
      if (liste) liste.push(r)
      else runsParRang.set(cle, [r])
    }
    const maxK = Math.min(MAX_RANGEES_BLOC, partySize)
    // Départs : chaque (section, rowOrder) présent, étendu tant que les rangs
    // suivants existent et que K ≤ maxK.
    const departs = new Set(runs.map((r) => `${r.section}:${r.rowOrder}`))
    for (const depart of departs) {
      const sep = depart.lastIndexOf(':')
      const section = depart.slice(0, sep)
      const o0 = Number(depart.slice(sep + 1))
      const rangsRuns: Run[][] = []
      for (let k = 0; k < maxK; k++) {
        const liste = runsParRang.get(`${section}:${o0 + k}`)
        if (!liste) break
        rangsRuns.push(liste)
        if (rangsRuns.length >= 2) meilleurBloc(rangsRuns, partySize, occupation, candidats)
      }
    }
  }

  if (candidats.length === 0) return []

  // Classement : qualité décroissante, départage par ids triés (déterministe).
  const cle = (c: Candidat) =>
    c.seats
      .map((s) => s.id)
      .sort()
      .join(',')
  candidats.sort((x, y) => {
    if (y.qualite !== x.qualite) return y.qualite - x.qualite
    const cx = cle(x)
    const cy = cle(y)
    return cx < cy ? -1 : cx > cy ? 1 : 0
  })

  // Un candidat est « distinct » s'il ne recouvre pas déjà la moitié des sièges
  // d'une suggestion retenue (évite deux propositions quasi-jumelles).
  const seuil = Math.ceil(partySize / 2)
  const distinct = (c: Candidat, prises: Candidat[]) => {
    const ids = new Set(c.seats.map((s) => s.id))
    return !prises.some((d) => d.seats.filter((s) => ids.has(s.id)).length >= seuil)
  }

  const fenetresCand = candidats.filter((c) => c.type === 'fenetre')
  const blocsCand = candidats.filter((c) => c.type === 'bloc')

  // Fenêtres ordonnées : une par rangée DISTINCTE d'abord (rangée X/Y/Z, un vrai
  // choix), puis les fenêtres restantes (mêmes rangées, décalées). Les blocs
  // arrivent après — donc seulement « le cas échéant ».
  const fenetresOrdonnees: Candidat[] = []
  const dejaVu = new Set<Candidat>()
  const rangsPris = new Set<string>()
  for (const c of fenetresCand) {
    const rowId = c.seats[0].rowId
    if (rangsPris.has(rowId)) continue
    fenetresOrdonnees.push(c)
    dejaVu.add(c)
    rangsPris.add(rowId)
  }
  for (const c of fenetresCand) if (!dejaVu.has(c)) fenetresOrdonnees.push(c)

  // Fenêtres (rangées distinctes en tête) PUIS blocs : on garde les 3 premières
  // suggestions distinctes dans cet ordre — la « même rangée » prime toujours.
  const choisies: Candidat[] = []
  for (const c of [...fenetresOrdonnees, ...blocsCand]) {
    if (choisies.length === 3) break
    if (distinct(c, choisies)) choisies.push(c)
  }

  return choisies.map((c): Suggestion => {
    const somme = c.seats.reduce((sum, s) => sum + s.score, 0)
    return { seatIds: c.seats.map((s) => s.id), score: Math.round(somme / c.seats.length) }
  })
}
