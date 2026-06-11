// Numérotation pair-impair : sens (impairs jardin / pairs cour), sauts de
// numérotation (ArcConfig.firstNumber) et gardes de parité. Verrouille aussi
// les sauts RÉELS de la salle de Bergerac (place.md : rangs M, O, R, T).

import { describe, expect, it } from 'vitest'

import { venueConfig, type VenueConfig } from '@/config/venue'
import { generateSeats } from '@/lib/venue/generate'

// Petite salle de test : un rang, centre 2+2 + extérieurs 2/2.
function miniConfig(opts: { extImpairDe?: number; extPairDe?: number } = {}): VenueConfig {
  return {
    center: { x: 0, y: 1000 },
    numberingScheme: 'pair-impair',
    rows: [
      {
        label: 'A',
        radius: 500,
        arcs: [
          {
            section: 'gauche',
            angleStart: -20,
            angleEnd: -12,
            seats: 2,
            ...(opts.extImpairDe !== undefined ? { firstNumber: opts.extImpairDe } : {}),
          },
          { section: 'centre', angleStart: -4.5, angleEnd: 4.5, seats: 4 },
          {
            section: 'droite',
            angleStart: 12,
            angleEnd: 20,
            seats: 2,
            ...(opts.extPairDe !== undefined ? { firstNumber: opts.extPairDe } : {}),
          },
        ],
      },
    ],
  }
}

function numeros(config: VenueConfig): { impairs: number[]; pairs: number[] } {
  const seats = generateSeats(config)
  return {
    impairs: seats.map((s) => s.number).filter((n) => n % 2 === 1).sort((a, b) => a - b),
    pairs: seats.map((s) => s.number).filter((n) => n % 2 === 0).sort((a, b) => a - b),
  }
}

describe('numérotation pair-impair', () => {
  it('sans firstNumber : numérotation consécutive depuis l’axe', () => {
    expect(numeros(miniConfig())).toEqual({ impairs: [1, 3, 5, 7], pairs: [2, 4, 6, 8] })
  })

  it('firstNumber crée un saut (extérieurs qui ne suivent pas le milieu)', () => {
    expect(numeros(miniConfig({ extImpairDe: 9, extPairDe: 12 }))).toEqual({
      impairs: [1, 3, 9, 11], // 5 et 7 n'existent pas
      pairs: [2, 4, 12, 14], // 6, 8 et 10 n'existent pas
    })
  })

  it('refuse un firstNumber de mauvaise parité', () => {
    expect(() => numeros(miniConfig({ extImpairDe: 8 }))).toThrow(/parité/)
  })

  it('refuse un firstNumber qui recule', () => {
    expect(() => numeros(miniConfig({ extPairDe: 2 }))).toThrow(/recule/)
  })
})

describe('salle de Bergerac — sauts réels (place.md)', () => {
  const seats = generateSeats(venueConfig)
  const nums = (label: string) => new Set(seats.filter((s) => s.rowLabel === label).map((s) => s.number))

  it.each([
    ['M', [15], 33, 32],
    ['O', [15, 14], 31, 30],
    ['R', [13, 14], 27, 28],
    ['T', [13, 12], 27, 26],
  ] as const)('rang %s : numéros %j absents, max %i/%i', (label, absents, maxImp, maxPair) => {
    const n = nums(label)
    for (const absent of absents) expect(n.has(absent)).toBe(false)
    expect(n.has(maxImp)).toBe(true)
    expect(n.has(maxPair)).toBe(true)
  })

  it('total : 754 sièges, 25 rangs', () => {
    expect(seats).toHaveLength(754)
    expect(new Set(seats.map((s) => s.rowLabel)).size).toBe(25)
  })
})
