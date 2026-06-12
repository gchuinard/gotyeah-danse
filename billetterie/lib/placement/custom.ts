// Moteur de placement « intelligent » — voir PLACEMENT.md.
//
// Principe : on énumère deux familles de candidats puis on garde les 3
// meilleurs (et distincts) :
//  - FENÊTRES : `partySize` sièges contigus sur une rangée (cas idéal) ;
//  - SCISSIONS : le groupe coupé sur 2 rangées adjacentes (même section,
//    rowOrder ±1), aligné sur la même colonne de départ → les uns devant les
//    autres (ex. 3 + 3 pour un groupe de 6). C'est un droit, donc pénalisé
//    face à une fenêtre, d'autant plus que les deux morceaux sont déséquilibrés.
//
// Qualité = somme des SCORES STATIQUES des sièges − malus des « restes »
// (morceaux de run laissés à côté, quasi invendables en taille 1) − coût de
// scission. On classe par qualité ; à qualité égale, départage déterministe
// par les ids triés. Fonction PURE et déterministe (on reconstruit l'ordre).

import type { PlacementFn, SeatState, Suggestion } from './types'

export const implemented = true

// Malus d'un reste de run (PLACEMENT.md §3) : un siège seul est quasi
// invendable, un reste de 4+ reste pleinement exploitable.
function malusReste(n: number): number {
  if (n <= 0) return 0
  if (n === 1) return 30
  if (n === 2) return 8
  if (n === 3) return 3
  return 0
}

const MALUS_SCISSION_BASE = 12 // handicap d'une scission face à une fenêtre
const MALUS_DESEQUILIBRE = 5 // par siège d'écart entre les deux morceaux

type Run = {
  rowId: string
  section: string
  rowOrder: number
  seats: SeatState[] // libres, indexInRow consécutifs croissants
  base: number // indexInRow du premier siège du run
  prefix: number[] // prefix[k] = somme des scores des k premiers sièges
}

type Candidat = { seats: SeatState[]; qualite: number }

// Découpe les sièges LIBRES en runs maximaux (même rowId, indexInRow
// consécutifs). Reconstruit l'ordre → indépendant de l'entrée (déterminisme).
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

// Toutes les fenêtres de taille n d'un run.
function fenetres(run: Run, n: number, out: Candidat[]): void {
  const L = run.seats.length
  for (let p = 0; p + n <= L; p++) {
    const qualite = sommeScore(run, p, n) - malusReste(p) - malusReste(L - (p + n))
    out.push({ seats: run.seats.slice(p, p + n), qualite })
  }
}

// Meilleure scission du groupe sur deux runs adjacents (devant rf / derrière
// rb), alignée sur une colonne de départ commune (les deux morceaux démarrent
// au même indexInRow → leurs plages se chevauchent : invariant 4).
function meilleureScission(rf: Run, rb: Run, n: number, out: Candidat[]): void {
  let best: Candidat | null = null
  for (let aF = 1; aF <= n - 1; aF++) {
    const aB = n - aF
    if (aF > rf.seats.length || aB > rb.seats.length) continue
    const cMin = Math.max(rf.base, rb.base)
    const cMax = Math.min(rf.base + rf.seats.length - aF, rb.base + rb.seats.length - aB)
    for (let c = cMin; c <= cMax; c++) {
      const pf = c - rf.base
      const pb = c - rb.base
      const score = sommeScore(rf, pf, aF) + sommeScore(rb, pb, aB)
      const restes =
        malusReste(pf) +
        malusReste(rf.seats.length - (pf + aF)) +
        malusReste(pb) +
        malusReste(rb.seats.length - (pb + aB))
      const penalite = MALUS_SCISSION_BASE + MALUS_DESEQUILIBRE * Math.abs(aF - aB)
      const qualite = score - restes - penalite
      if (!best || qualite > best.qualite) {
        best = { seats: [...rf.seats.slice(pf, pf + aF), ...rb.seats.slice(pb, pb + aB)], qualite }
      }
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

  // Scissions sur 2 rangées adjacentes de la même section.
  if (partySize >= 2) {
    const parSectionRang = new Map<string, Run[]>()
    for (const r of runs) {
      const cle = `${r.section}:${r.rowOrder}`
      const liste = parSectionRang.get(cle)
      if (liste) liste.push(r)
      else parSectionRang.set(cle, [r])
    }
    for (const rf of runs) {
      const derriere = parSectionRang.get(`${rf.section}:${rf.rowOrder + 1}`)
      if (!derriere) continue
      for (const rb of derriere) meilleureScission(rf, rb, partySize, candidats)
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
    const recouvre = choisies.some(
      (d) => d.seats.filter((s) => ids.has(s.id)).length >= seuil,
    )
    if (!recouvre) choisies.push(c)
  }

  return choisies.map((c): Suggestion => {
    const total = c.seats.reduce((sum, s) => sum + s.score, 0)
    return { seatIds: c.seats.map((s) => s.id), score: Math.round(total / c.seats.length) }
  })
}
