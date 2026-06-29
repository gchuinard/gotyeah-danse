// Génération du plan de salle depuis une VenueConfig — fonction PURE.
//
// `staticScore` et `arcAngles` ne sont pas exportés : on les éprouve à travers
// les champs publics d'un GeneratedSeat (`score`, `angle`, `number`, `x`/`y`).
// On bâtit de petites VenueConfig synthétiques pour ISOLER un comportement, et
// on confronte le générateur à la vraie `venueConfig` pour les invariants de
// masse (comptes, ids, rowOrder…). Les assertions de score portent sur des
// PROPRIÉTÉS (bornes, monotonies, symétries), pas sur des nombres magiques.

import { describe, expect, it } from 'vitest'

import { venueConfig } from '@/config/venue'
import type { ArcConfig, NumberingScheme, RowConfig, SectionId, VenueConfig } from '@/config/venue'
import { SECTION_ORDER, generateSeats, planBounds } from '@/lib/venue/generate'

// ── Petits constructeurs typés pour des configs lisibles ────────────────────

const arc = (
  section: SectionId,
  angleStart: number,
  angleEnd: number,
  seats: number,
  extra: Partial<ArcConfig> = {},
): ArcConfig => ({ section, angleStart, angleEnd, seats, ...extra })

const row = (label: string, radius: number, arcs: ArcConfig[], xOffset?: number): RowConfig => ({
  label,
  radius,
  arcs,
  ...(xOffset !== undefined ? { xOffset } : {}),
})

const venue = (rows: RowConfig[], numberingScheme: NumberingScheme = 'continu'): VenueConfig => ({
  center: { x: 0, y: 0 },
  rows,
  numberingScheme,
})

// Un rang = un seul siège central à l'angle donné (sert aux tests de cloche).
const rangSiegeUnique = (label: string, radius: number, angle: number): RowConfig =>
  row(label, radius, [arc('centre', angle, angle, 1)])

function grouperPar<T>(items: T[], cle: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const arr = m.get(cle(it))
    if (arr) arr.push(it)
    else m.set(cle(it), [it])
  }
  return m
}

const totalSiegesConfig = (config: VenueConfig): number =>
  config.rows.flatMap((r) => r.arcs).reduce((n, a) => n + a.seats, 0)

// ── Comptes & structure ─────────────────────────────────────────────────────

describe('generateSeats — comptes et structure', () => {
  it('produit exactement le nombre de sièges déclaré (config synthétique)', () => {
    const config = venue([
      row('Z', 100, [arc('gauche', -30, -20, 3), arc('centre', -5, 5, 4), arc('droite', 20, 30, 3)]),
      row('Y', 120, [arc('centre', -10, 10, 5)]),
    ])
    expect(generateSeats(config)).toHaveLength(3 + 4 + 3 + 5)
    expect(generateSeats(config)).toHaveLength(totalSiegesConfig(config))
  })

  it('produit exactement le nombre de sièges de la vraie salle', () => {
    expect(generateSeats(venueConfig)).toHaveLength(totalSiegesConfig(venueConfig))
  })

  it('ids déterministes : deux appels donnent le même résultat', () => {
    const a = generateSeats(venueConfig)
    const b = generateSeats(venueConfig)
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id))
  })

  it('ids uniques et bien formés (section-rang-indexInRow sur 2 chiffres)', () => {
    const seats = generateSeats(venueConfig)
    const ids = seats.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(seats.every((s) => /^(gauche|centre|droite)-[A-Z]+-\d{2}$/.test(s.id))).toBe(true)
  })

  it('rowOrder = index du rang dans la config (0 = scène)', () => {
    const seats = generateSeats(venueConfig)
    const labelVersIndex = new Map(venueConfig.rows.map((r, i) => [r.label, i]))
    expect(seats.every((s) => s.rowOrder === labelVersIndex.get(s.rowLabel))).toBe(true)
  })

  it('sectionOrder cohérent avec SECTION_ORDER', () => {
    const seats = generateSeats(venueConfig)
    expect(seats.every((s) => s.sectionOrder === SECTION_ORDER[s.section])).toBe(true)
  })

  it('removable : propagé par arc, false par défaut', () => {
    const seats = generateSeats(
      venue([row('Z', 100, [arc('gauche', -30, -20, 2, { removable: true }), arc('centre', -5, 5, 2)])]),
    )
    expect(seats.filter((s) => s.section === 'gauche').every((s) => s.removable)).toBe(true)
    expect(seats.filter((s) => s.section === 'centre').every((s) => s.removable === false)).toBe(true)
  })
})

// ── indexInRow ───────────────────────────────────────────────────────────────

describe('generateSeats — indexInRow', () => {
  it('un arc unique : indexInRow consécutifs depuis 0', () => {
    const seats = generateSeats(venue([row('Z', 100, [arc('centre', -20, 20, 5)])]))
    expect(seats.map((s) => s.indexInRow).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  it('chaque section repart de 0', () => {
    const seats = generateSeats(
      venue([row('Z', 100, [arc('gauche', -40, -30, 2), arc('centre', -10, 10, 3), arc('droite', 20, 30, 2)])]),
    )
    const parSection = grouperPar(seats, (s) => s.section)
    expect(parSection.get('gauche')!.map((s) => s.indexInRow).sort((a, b) => a - b)).toEqual([0, 1])
    expect(parSection.get('centre')!.map((s) => s.indexInRow).sort((a, b) => a - b)).toEqual([0, 1, 2])
    expect(parSection.get('droite')!.map((s) => s.indexInRow).sort((a, b) => a - b)).toEqual([0, 1])
  })

  it('deux arcs SÉPARÉS d’une même section : saut d’un index (trou)', () => {
    const seats = generateSeats(venue([row('Z', 100, [arc('centre', -10, 0, 3), arc('centre', 10, 20, 2)])]))
    const idx = seats.map((s) => s.indexInRow).sort((a, b) => a - b)
    expect(idx).toEqual([0, 1, 2, 4, 5]) // l'index 3 est sauté
    expect(idx).not.toContain(3)
  })

  it('contiguousWithPrevious : la séquence continue sans trou', () => {
    const seats = generateSeats(
      venue([row('Z', 100, [arc('centre', -10, 0, 3), arc('centre', 10, 20, 2, { contiguousWithPrevious: true })])]),
    )
    expect(seats.map((s) => s.indexInRow).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  it('vraie salle : indexInRow consécutifs depuis 0 dans chaque rowId', () => {
    const seats = generateSeats(venueConfig)
    for (const [, group] of grouperPar(seats, (s) => s.rowId)) {
      const idx = group.map((s) => s.indexInRow).sort((a, b) => a - b)
      expect(idx).toEqual(idx.map((_, i) => i))
    }
  })
})

// ── Géométrie : arcAngles + projection x/y ──────────────────────────────────

describe('generateSeats — géométrie', () => {
  it('arc à 1 siège : placé à l’angle médian', () => {
    const seats = generateSeats(venue([row('Z', 100, [arc('centre', -10, 30, 1)])]))
    expect(seats).toHaveLength(1)
    expect(seats[0].angle).toBeCloseTo(10) // (−10 + 30) / 2
  })

  it('arc à N sièges : bornes incluses et pas uniforme', () => {
    const seats = generateSeats(venue([row('Z', 100, [arc('centre', -20, 40, 4)])]))
    const angles = seats.map((s) => s.angle).sort((a, b) => a - b)
    expect(angles[0]).toBeCloseTo(-20) // angleStart inclus
    expect(angles[angles.length - 1]).toBeCloseTo(40) // angleEnd inclus
    const pas = angles.slice(1).map((a, i) => a - angles[i])
    for (const p of pas) expect(p).toBeCloseTo(pas[0]) // espacement constant
  })

  it('projection : angle 0 → pile sous le centre, à distance radius', () => {
    const config: VenueConfig = {
      center: { x: 100, y: 200 },
      numberingScheme: 'continu',
      rows: [row('Z', 50, [arc('centre', 0, 0, 1)])],
    }
    const [s] = generateSeats(config)
    expect(s.x).toBeCloseTo(100) // cx + r·sin(0)
    expect(s.y).toBeCloseTo(150) // cy − r·cos(0) = 200 − 50
  })

  it('xOffset décale x, laisse y intact', () => {
    const base: VenueConfig = {
      center: { x: 100, y: 200 },
      numberingScheme: 'continu',
      rows: [row('Z', 50, [arc('centre', 0, 0, 1)], 15)],
    }
    const [s] = generateSeats(base)
    expect(s.x).toBeCloseTo(115) // 100 + 0 + 15
    expect(s.y).toBeCloseTo(150)
  })

  it('signe de l’angle : cour (positif) à droite, jardin (négatif) à gauche', () => {
    const seats = generateSeats(venue([row('Z', 100, [arc('centre', -30, 30, 3)])]))
    const jardin = seats.find((s) => s.angle < 0)!
    const cour = seats.find((s) => s.angle > 0)!
    expect(jardin.x).toBeLessThan(0) // center.x = 0
    expect(cour.x).toBeGreaterThan(0)
  })
})

// ── Numérotation continue ────────────────────────────────────────────────────

describe('generateSeats — numérotation continu', () => {
  it('1..N de jardin à cour, dans l’ordre des angles', () => {
    const seats = generateSeats(venue([row('Z', 100, [arc('centre', -20, 40, 4)])], 'continu'))
    const ordreParAngle = [...seats].sort((a, b) => a.angle - b.angle).map((s) => s.number)
    expect(ordreParAngle).toEqual([1, 2, 3, 4])
  })
})

// ── Numérotation pair-impair ─────────────────────────────────────────────────

describe('generateSeats — numérotation pair-impair', () => {
  it('impairs côté jardin, pairs côté cour, croissants depuis l’axe', () => {
    const seats = generateSeats(venue([row('Z', 100, [arc('centre', -15, 15, 4)])], 'pair-impair'))
    const parAngle = new Map(seats.map((s) => [s.angle, s.number]))
    expect(parAngle.get(-5)).toBe(1) // le plus proche de l'axe, côté jardin
    expect(parAngle.get(5)).toBe(2) // le plus proche de l'axe, côté cour
    expect(parAngle.get(-15)).toBe(3)
    expect(parAngle.get(15)).toBe(4)
    expect(seats.filter((s) => s.angle < 0).every((s) => s.number % 2 === 1)).toBe(true)
    expect(seats.filter((s) => s.angle >= 0).every((s) => s.number % 2 === 0)).toBe(true)
  })

  it('firstNumber : reproduit un saut de numérotation', () => {
    const config = venue(
      [row('T', 100, [arc('centre', -5, 5, 2), arc('droite', 10, 30, 3, { firstNumber: 14 })])],
      'pair-impair',
    )
    const seats = generateSeats(config)
    const centreCour = seats.find((s) => s.section === 'centre' && s.angle > 0)!
    expect(centreCour.number).toBe(2) // numérotation continue jusqu'au saut
    const droite = seats.filter((s) => s.section === 'droite').map((s) => s.number).sort((a, b) => a - b)
    expect(droite).toEqual([14, 16, 18]) // saute 4..12, reprend à firstNumber
  })

  it('firstNumber de parité invalide → erreur', () => {
    const config = venue([row('T', 100, [arc('droite', 5, 5, 1, { firstNumber: 13 })])], 'pair-impair')
    expect(() => generateSeats(config)).toThrow(/parité invalide/)
  })

  it('firstNumber qui recule → erreur', () => {
    const config = venue(
      [row('T', 100, [arc('droite', 5, 25, 5), arc('droite', 30, 40, 2, { firstNumber: 4 })])],
      'pair-impair',
    )
    expect(() => generateSeats(config)).toThrow(/recule/)
  })
})

// ── Score statique : bornes + cloche (rowOrder) + centralité (angle) ─────────

describe('staticScore (via Seat.score) — bornes', () => {
  it('toujours borné 0..100 sur la vraie salle', () => {
    const scores = generateSeats(venueConfig).map((s) => s.score)
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...scores)).toBeLessThanOrEqual(100)
  })

  it('plancher de centralité : aucun siège ne tombe à 0 (bord ≠ « nul »)', () => {
    const scores = generateSeats(venueConfig).map((s) => s.score)
    expect(Math.min(...scores)).toBeGreaterThan(0)
  })
})

describe('staticScore (via Seat.score) — cloche selon le rang physique', () => {
  // 15 rangs, tous un siège unique sur l'axe (angle 0) : le score ne dépend
  // alors plus que du rowOrder → on isole la cloche.
  const surAxe = generateSeats(venue(Array.from({ length: 15 }, (_, i) => rangSiegeUnique(`R${i}`, 100 + i, 0))))
  const scoreParRang = [...surAxe].sort((a, b) => a.rowOrder - b.rowOrder).map((s) => s.score)
  const rangIdeal = 9 // ROW_IDEAL du module

  it('maximum atteint au rang idéal, centre, sur l’axe → 100', () => {
    expect(scoreParRang[rangIdeal]).toBe(100)
    expect(Math.max(...scoreParRang)).toBe(scoreParRang[rangIdeal])
  })

  it('croît strictement jusqu’au rang idéal puis décroît strictement', () => {
    for (let r = 0; r < rangIdeal; r++) expect(scoreParRang[r]).toBeLessThan(scoreParRang[r + 1])
    for (let r = rangIdeal; r < scoreParRang.length - 1; r++) {
      expect(scoreParRang[r]).toBeGreaterThan(scoreParRang[r + 1])
    }
  })

  it('symétrique autour du rang idéal (rowOrder identique de part et d’autre)', () => {
    for (let k = 1; k <= 5; k++) expect(scoreParRang[rangIdeal - k]).toBe(scoreParRang[rangIdeal + k])
  })
})

describe('staticScore (via Seat.score) — centralité angulaire', () => {
  // Un seul rang (rowOrder figé) : le score ne varie plus qu'avec |angle|.
  const seats = generateSeats(venue([row('Z', 100, [arc('centre', -40, 40, 9)])]))
  const parAngle = [...seats].sort((a, b) => a.angle - b.angle) // index 4 = angle 0
  const scores = parAngle.map((s) => s.score)
  const centre = 4

  it('le siège sur l’axe a le meilleur score du rang', () => {
    expect(parAngle[centre].angle).toBeCloseTo(0)
    expect(scores[centre]).toBe(Math.max(...scores))
  })

  it('décroît strictement à mesure que |angle| augmente', () => {
    for (let i = centre; i < scores.length - 1; i++) expect(scores[i]).toBeGreaterThan(scores[i + 1])
    for (let i = centre; i > 0; i--) expect(scores[i]).toBeGreaterThan(scores[i - 1])
  })

  it('symétrie angulaire : +angle et −angle ont le même score', () => {
    for (let k = 1; k <= centre; k++) expect(scores[centre - k]).toBe(scores[centre + k])
  })
})

// ── planBounds ───────────────────────────────────────────────────────────────

describe('planBounds', () => {
  const seats = generateSeats(venueConfig)
  const xs = seats.map((s) => s.x)
  const ys = seats.map((s) => s.y)

  it('englobe tous les sièges', () => {
    const b = planBounds(seats, 60)
    expect(seats.every((s) => s.x >= b.minX && s.x <= b.minX + b.width)).toBe(true)
    expect(seats.every((s) => s.y >= b.minY && s.y <= b.minY + b.height)).toBe(true)
  })

  it('marge 0 : la boîte épouse exactement les extrêmes', () => {
    const b = planBounds(seats, 0)
    expect(b.minX).toBeCloseTo(Math.min(...xs))
    expect(b.minX + b.width).toBeCloseTo(Math.max(...xs))
    expect(b.minY).toBeCloseTo(Math.min(...ys))
    expect(b.minY + b.height).toBeCloseTo(Math.max(...ys))
  })

  it('marge par défaut = 60', () => {
    const b = planBounds(seats)
    expect(b.minX).toBeCloseTo(Math.min(...xs) - 60)
    expect(b.minY).toBeCloseTo(Math.min(...ys) - 60)
  })

  it('la marge s’applique des deux côtés (largeur/hauteur += 2·marge)', () => {
    const b0 = planBounds(seats, 0)
    const b100 = planBounds(seats, 100)
    expect(b100.minX).toBeCloseTo(b0.minX - 100)
    expect(b100.minY).toBeCloseTo(b0.minY - 100)
    expect(b100.width).toBeCloseTo(b0.width + 200)
    expect(b100.height).toBeCloseTo(b0.height + 200)
  })
})

// ── SECTION_ORDER ────────────────────────────────────────────────────────────

describe('SECTION_ORDER', () => {
  it('gauche < centre < droite', () => {
    expect(SECTION_ORDER.gauche).toBeLessThan(SECTION_ORDER.centre)
    expect(SECTION_ORDER.centre).toBeLessThan(SECTION_ORDER.droite)
    expect(SECTION_ORDER).toEqual({ gauche: 0, centre: 1, droite: 2 })
  })
})
