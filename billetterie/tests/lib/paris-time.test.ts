// La salle vit à l'heure de Paris, la base en UTC : ces conversions portent
// les dates des représentations — une erreur ici décale tout le spectacle.

import { describe, expect, it } from 'vitest'
import { parisToUtc, toParisInputValue } from '@/lib/paris-time'

describe('parisToUtc', () => {
  it('été : 20h30 à Paris = 18h30 UTC (UTC+2)', () => {
    expect(parisToUtc('2026-06-20T20:30').toISOString()).toBe('2026-06-20T18:30:00.000Z')
  })

  it('hiver : 15h00 à Paris = 14h00 UTC (UTC+1)', () => {
    expect(parisToUtc('2026-01-18T15:00').toISOString()).toBe('2026-01-18T14:00:00.000Z')
  })
})

describe('toParisInputValue', () => {
  it('été : 18h30 UTC s’affiche 20h30', () => {
    expect(toParisInputValue(new Date('2026-06-20T18:30:00Z'))).toBe('2026-06-20T20:30')
  })

  it('hiver : 14h00 UTC s’affiche 15h00', () => {
    expect(toParisInputValue(new Date('2026-01-18T14:00:00Z'))).toBe('2026-01-18T15:00')
  })

  it('aller-retour stable', () => {
    const input = '2026-06-20T20:30'
    expect(toParisInputValue(parisToUtc(input))).toBe(input)
  })
})
