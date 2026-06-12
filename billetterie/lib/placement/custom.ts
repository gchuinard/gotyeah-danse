// Moteur de placement « intelligent » — voir PLACEMENT.md.
//
// Deux familles de candidats, on garde les 3 meilleurs (et distincts) :
//  - FENÊTRES : `partySize` sièges contigus sur UNE rangée (cas idéal) ;
//  - BLOCS : le groupe réparti sur K rangées ADJACENTES de la même section
//    (rowOrder consécutifs), chaque rangée contiguë, toutes alignées sur la
//    même colonne de départ → un bloc vertical d'un seul tenant (les uns
//    devant les autres). Ex. 6 = 3+3 sur 2 rangs, 15 = 5+5+5 sur 3 rangs.
//    Plus le bloc compte de rangées, plus il est pénalisé (on préfère
//    regrouper sur peu de rangs).
//
// Qualité = somme des SCORES STATIQUES − malus des « restes » (morceaux de run
// laissés à côté, quasi invendables en taille 1) − coût du bloc (par rangée
// au-delà de la première). Classement par qualité ; départage déterministe par
// ids triés. Fonction PURE et déterministe (on reconstruit l'ordre d'entrée).

import type { PlacementFn, SeatState, Suggestion } from './types'

export const implemented = true

// Au-delà, un « bloc » deviendrait une colonne trop haute et étroite : on
// préfère renvoyer vide (placement manuel) qu'une suggestion absurde.
const MAX_RANGEES_BLOC = 8

// Malus d'un reste de run (PLACEMENT.md §3) : un siège seul est quasi
// invendable, un reste de 4+ reste pleinement exploitable.
function malusReste(n: number): number {
  if (n <= 0) return 0
  if (n === 1) return 30
  if (n === 2) return 8
  if (n === 3) return 3
  return 0
}

const MALUS_RANGEE_SUP = 12 // par rangée au-delà de la première (préfère regrouper)

type Run = {
  rowId: string
  section: string
  rowOrder: number
  seats: SeatState[] // libres, indexInRow consécutifs croissants
  base: number // indexInRow du premier siège du run
  prefix: number[] // prefix[k] = somme des scores des k premiers sièges
}

type Candidat = { seats: SeatState[]; qualite: number }
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
function fenetres(run: Run, n: number, out: Candidat[]): void {
  const L = run.seats.length
  for (let p = 0; p + n <= L; p++) {
    const qualite = sommeScore(run, p, n) - malusReste(p) - malusReste(L - (p + n))
    out.push({ seats: run.seats.slice(p, p + n), qualite })
  }
}

// Meilleur bloc du groupe sur K rangées adjacentes (rangsRuns[i] = runs de la
// i-ème rangée). Répartition équilibrée, toutes les fenêtres démarrent à la
// même colonne c → bloc vertical d'un seul tenant.
function meilleurBloc(rangsRuns: Run[][], n: number, out: Candidat[]): void {
  const K = rangsRuns.length
  const base = Math.floor(n / K)
  if (base < 1) return // une rangée recevrait 0 siège : K trop grand pour n
  const extra = n % K
  const parts = rangsRuns.map((_, i) => base + (i < extra ? 1 : 0))

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
      const qualite = score - restes - MALUS_RANGEE_SUP * (K - 1)
      if (!best || qualite > best.qualite) best = { seats, qualite }
    }
  }
  if (best) out.push(best)
}

export const suggestPlacement: PlacementFn = (seats, partySize) => {
  if (!Number.isInteger(partySize) || partySize < 1) return []

  const runs = construireRuns(seats)
  const candidats: Candidat[] = []

  // Fenêtres mono-rangée.
  for (const run of runs) {
    if (run.seats.length >= partySize) fenetres(run, partySize, candidats)
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
        if (rangsRuns.length >= 2) meilleurBloc(rangsRuns, partySize, candidats)
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

  // 3 suggestions DISTINCTES : on écarte un candidat qui recouvre trop une
  // suggestion déjà retenue (≥ la moitié de ses sièges) — un vrai choix.
  const choisies: Candidat[] = []
  const seuil = Math.ceil(partySize / 2)
  for (const c of candidats) {
    if (choisies.length === 3) break
    const ids = new Set(c.seats.map((s) => s.id))
    const recouvre = choisies.some((d) => d.seats.filter((s) => ids.has(s.id)).length >= seuil)
    if (!recouvre) choisies.push(c)
  }

  return choisies.map((c): Suggestion => {
    const total = c.seats.reduce((sum, s) => sum + s.score, 0)
    return { seatIds: c.seats.map((s) => s.id), score: Math.round(total / c.seats.length) }
  })
}
