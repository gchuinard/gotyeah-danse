// Simulateur Monte Carlo : compare les implémentations de placement en
// remplissant la salle réelle (config/venue.ts) avec des groupes de tailles
// aléatoires jusqu'au premier refus. AUCUN algorithme de placement ici —
// on APPELLE les implémentations existantes via PLACEMENT_IMPLS, c'est tout.
//
// Lancer depuis billetterie/ : pnpm simulate --impl=baseline --runs=200 --seed=42
// (flags optionnels ; défauts : impl=baseline ou PLACEMENT_IMPL, runs=200, seed=42)
//
// Pure mémoire : pas de DB, pas de Date.now(), pas de Math.random() —
// tout l'aléatoire passe par mulberry32 et le seed → résultats reproductibles.

import { loadVenueConfig } from '../lib/venue/load'
import { PLACEMENT_IMPLS, type PlacementImpl } from '../lib/placement'
import type { SeatState } from '../lib/placement/types'
import { generateSeats } from '../lib/venue/generate'

// ── CLI ──────────────────────────────────────────────────────────────────

type CliOptions = { impl: PlacementImpl; runs: number; seed: number }

function fail(message: string): never {
  console.error(`Erreur : ${message}`)
  console.error('Usage : pnpm simulate [--impl=baseline|custom] [--runs=200] [--seed=42]')
  process.exit(1)
}

function parseArgs(argv: string[]): CliOptions {
  const defaults: CliOptions = {
    impl: process.env.PLACEMENT_IMPL === 'custom' ? 'custom' : 'baseline',
    runs: 200,
    seed: 42,
  }

  for (const arg of argv) {
    const match = /^--(impl|runs|seed)=(.*)$/.exec(arg)
    if (!match) fail(`argument inconnu « ${arg} »`)
    const [, key, value] = match

    if (key === 'impl') {
      if (value !== 'baseline' && value !== 'custom') {
        fail(`--impl doit valoir « baseline » ou « custom » (reçu « ${value} »)`)
      }
      defaults.impl = value
    } else {
      const n = Number(value)
      if (!Number.isInteger(n) || n <= 0) {
        fail(`--${key} doit être un entier strictement positif (reçu « ${value} »)`)
      }
      if (key === 'runs') defaults.runs = n
      else defaults.seed = n
    }
  }
  return defaults
}

// ── RNG ──────────────────────────────────────────────────────────────────

// mulberry32 : PRNG seedé 32 bits classique, retourne des flottants [0, 1).
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Distribution des tailles de groupes : 2→40 %, 3→25 %, 4→20 %, 5→10 %, 6→5 %.
const GROUP_DISTRIBUTION: Array<{ size: number; cumul: number }> = [
  { size: 2, cumul: 0.4 },
  { size: 3, cumul: 0.65 },
  { size: 4, cumul: 0.85 },
  { size: 5, cumul: 0.95 },
  { size: 6, cumul: 1 },
]

function drawGroupSize(rng: () => number): number {
  const x = rng()
  for (const { size, cumul } of GROUP_DISTRIBUTION) {
    if (x < cumul) return size
  }
  return 6
}

// ── Métriques des « restes » ─────────────────────────────────────────────

// Histogramme des séquences contiguës de sièges libres : longueurs 1, 2, 3, ≥4.
type LeftoverHistogram = [number, number, number, number]

// Malus par longueur de reste : un siège isolé est quasi invendable, un trou
// de 4+ reste vendable. MÉTRIQUE d'évaluation du résultat final uniquement.
const LEFTOVER_PENALTY = [30, 8, 3, 0] as const

// Parcourt chaque rangée (rowId = section + rang : la contiguïté n'existe
// qu'au sein d'un rowId) et mesure les runs d'indexInRow consécutifs libres.
function measureLeftovers(seats: SeatState[]): { histogram: LeftoverHistogram; penalty: number } {
  const byRow = new Map<string, SeatState[]>()
  for (const seat of seats) {
    if (!seat.free) continue
    const row = byRow.get(seat.rowId)
    if (row) row.push(seat)
    else byRow.set(seat.rowId, [seat])
  }

  const histogram: LeftoverHistogram = [0, 0, 0, 0]
  let penalty = 0
  const record = (length: number) => {
    if (length === 0) return
    const bucket = Math.min(length, 4) - 1
    histogram[bucket] += 1
    penalty += LEFTOVER_PENALTY[bucket]
  }

  for (const row of byRow.values()) {
    row.sort((a, b) => a.indexInRow - b.indexInRow)
    let runLength = 1
    for (let i = 1; i < row.length; i++) {
      if (row[i].indexInRow === row[i - 1].indexInRow + 1) {
        runLength++
      } else {
        record(runLength)
        runLength = 1
      }
    }
    record(row.length > 0 ? runLength : 0)
  }
  return { histogram, penalty }
}

// ── Un run de simulation ─────────────────────────────────────────────────

type RunResult = {
  occupied: number
  fillRate: number // %
  groupsPlaced: number
  refusedSize: number
  histogram: LeftoverHistogram
  penalty: number
}

function simulateRun(
  impl: PlacementImpl,
  initialSeats: readonly SeatState[],
  rng: () => number,
): RunResult {
  const { fn } = PLACEMENT_IMPLS[impl]
  // On repart d'une salle vide ; à chaque placement on reconstruit le tableau
  // sans muter les objets déjà passés à la fonction de placement.
  let seats: SeatState[] = initialSeats.map((s) => ({ ...s }))

  let groupsPlaced = 0
  let refusedSize = 0

  for (;;) {
    const partySize = drawGroupSize(rng)
    const suggestions = fn(seats, partySize)
    if (suggestions.length === 0) {
      // Première demande non plaçable : on mesure le remplissage atteint
      // au moment où on commence à refuser du monde.
      refusedSize = partySize
      break
    }
    // On prend la PREMIÈRE suggestion (la meilleure, invariant n°1).
    const taken = new Set(suggestions[0].seatIds)
    seats = seats.map((s) => (taken.has(s.id) ? { ...s, free: false } : s))
    groupsPlaced++
  }

  const occupied = seats.filter((s) => !s.free).length
  const { histogram, penalty } = measureLeftovers(seats)
  return {
    occupied,
    fillRate: (occupied / seats.length) * 100,
    groupsPlaced,
    refusedSize,
    histogram,
    penalty,
  }
}

// ── Agrégation et rapport ────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function report(options: CliOptions, totalSeats: number, results: RunResult[]): string {
  const fillRates = results.map((r) => r.fillRate)
  const avgHistogram = [0, 1, 2, 3].map((i) => mean(results.map((r) => r.histogram[i])))

  const fmt = (n: number, decimals = 2) => n.toFixed(decimals)
  const line = (label: string, value: string) => `  ${label.padEnd(38, '.')} ${value}`

  return [
    '═══ Simulateur de placement — Monte Carlo ═══',
    '',
    line('Implémentation', options.impl),
    line('Runs', String(options.runs)),
    line('Seed', String(options.seed)),
    line('Sièges dans la salle', String(totalSeats)),
    '',
    'Remplissage au premier refus :',
    line('Taux moyen', `${fmt(mean(fillRates))} %`),
    line('Taux min', `${fmt(Math.min(...fillRates))} %`),
    line('Taux max', `${fmt(Math.max(...fillRates))} %`),
    line('Sièges occupés (moyenne)', fmt(mean(results.map((r) => r.occupied)))),
    line('Groupes placés (moyenne)', fmt(mean(results.map((r) => r.groupsPlaced)))),
    line('Taille du groupe refusé (moyenne)', fmt(mean(results.map((r) => r.refusedSize)))),
    '',
    'Restes (séquences contiguës libres, moyenne par run) :',
    line('Longueur 1 (malus 30)', fmt(avgHistogram[0])),
    line('Longueur 2 (malus 8)', fmt(avgHistogram[1])),
    line('Longueur 3 (malus 3)', fmt(avgHistogram[2])),
    line('Longueur ≥4 (malus 0)', fmt(avgHistogram[3])),
    line('Malus total (moyenne)', fmt(mean(results.map((r) => r.penalty)))),
    '',
  ].join('\n')
}

// ── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  const options = parseArgs(process.argv.slice(2))

  if (!PLACEMENT_IMPLS[options.impl].implemented) {
    console.error(
      `L'implémentation « ${options.impl} » n'est pas encore implémentée ` +
        `(flag implemented=false) — voir lib/placement/custom.ts et PLACEMENT.md.`,
    )
    process.exit(1)
  }

  // Mapping GeneratedSeat → SeatState : tous les sièges (amovibles compris),
  // tous libres au départ.
  const initialSeats: SeatState[] = generateSeats(loadVenueConfig()).map((s) => ({
    id: s.id,
    section: s.section,
    rowId: s.rowId,
    rowLabel: s.rowLabel,
    rowOrder: s.rowOrder,
    indexInRow: s.indexInRow,
    number: s.number,
    score: s.score,
    free: true,
  }))

  const results: RunResult[] = []
  for (let i = 0; i < options.runs; i++) {
    // État dérivé déterministe du seed de base : runs indépendants,
    // même seed → mêmes résultats exactement.
    const rng = mulberry32((options.seed + Math.imul(i, 0x9e3779b9)) >>> 0)
    results.push(simulateRun(options.impl, initialSeats, rng))
  }

  console.log(report(options, initialSeats.length, results))
}

main()
