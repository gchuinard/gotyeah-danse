// Parser de la notation place.md + construction d'une salle : on vérifie que
// des lignes RÉELLES du relevé de Bergerac redonnent les bons numéros (sauts
// compris) une fois passées dans buildVenueConfig + generateSeats.

import { describe, expect, it } from 'vitest'

import { BUILDER_DEFAULTS, buildVenueConfig } from '@/lib/venue/build'
import { generateSeats } from '@/lib/venue/generate'
import { parsePlaceLine, parsePlaceNotation } from '@/lib/venue/place-notation'

describe('parsePlaceLine', () => {
  it('rang standard : B 37/19 17/1 2/18 20/38', () => {
    expect(parsePlaceLine('B 37/19 17/1 2/18 20/38')).toEqual({
      label: 'B',
      centre: { nNeg: 9, nPos: 9, removable: false },
      extJardin: { seats: 10, firstNumber: 19, removable: false },
      extCour: { seats: 10, firstNumber: 20, removable: false },
    })
  })

  it('rang continu : A 45/1 2/44', () => {
    expect(parsePlaceLine('A 45/1 2/44')).toEqual({
      label: 'A',
      centre: { nNeg: 23, nPos: 22, removable: false },
    })
  })

  it('fosse amovible : X (1/15) (2/16) 12', () => {
    expect(parsePlaceLine('X (1/15) (2/16) 12')).toEqual({
      label: 'X',
      centre: { nNeg: 8, nPos: 8, removable: true },
    })
  })

  it('extérieur amovible : W (21/11) 9/1 2/10 12/22 12', () => {
    const row = parsePlaceLine('W (21/11) 9/1 2/10 12/22 12')
    expect(row.extJardin).toEqual({ seats: 6, firstNumber: 11, removable: true })
    expect(row.centre).toEqual({ nNeg: 5, nPos: 5, removable: false })
  })

  it('capture les sauts : O 31/17 13/1 2/12 16/30 (15 et 14 absents)', () => {
    const row = parsePlaceLine('O 31/17 13/1 2/12 16/30 1')
    expect(row.extJardin?.firstNumber).toBe(17) // milieu s'arrête à 13 → saut de 15
    expect(row.extCour?.firstNumber).toBe(16) // milieu s'arrête à 12 → saut de 14
  })

  it.each([
    ['Z 35/17', /impair et un groupe pair/],
    ['Z 35/17 15/9 7/1 2/16 18/36', /sous-découpage/],
    ['Z 13/1 2/12 11/15', /chevauche/],
    ['Z 35/17 15/2 2/16 18/36', /mélange/],
    ['Z patate', /illisible/],
  ])('rejette %s', (ligne, erreur) => {
    expect(() => parsePlaceLine(ligne)).toThrow(erreur)
  })
})

describe('parsePlaceNotation + buildVenueConfig', () => {
  // Extrait du relevé réel (fond → scène), avec commentaires et flags.
  const releve = `
# partie haute
A 45/1 2/44
B 37/19 17/1 2/18 20/38
# milieu (O et T ont des sauts)
O 31/17 13/1 2/12 16/30 1
T 27/15 11/1 2/10 14/26 1
W (21/11) 9/1 2/10 12/22 12
X (1/15) (2/16) 12
`

  it('reproduit les numéros réels, sauts compris', () => {
    const rows = parsePlaceNotation(releve)
    expect(rows.map((r) => r.label)).toEqual(['A', 'B', 'O', 'T', 'W', 'X'])

    const config = buildVenueConfig({ name: 'Test', ...BUILDER_DEFAULTS }, rows)
    // Ordre scène → fond : X en premier (rowOrder 0), A en dernier.
    expect(config.rows[0].label).toBe('X')
    expect(config.rows.at(-1)?.label).toBe('A')

    const seats = generateSeats(config)
    const nums = (label: string) =>
      new Set(seats.filter((s) => s.rowLabel === label).map((s) => s.number))

    expect(Math.max(...nums('A'))).toBe(45)
    expect(nums('B').size).toBe(38)
    // O : sauts — 15 et 14 n'existent pas, max 31/30.
    expect(nums('O').has(15)).toBe(false)
    expect(nums('O').has(14)).toBe(false)
    expect(nums('O').has(31)).toBe(true)
    expect(nums('O').has(30)).toBe(true)
    // T : 13 et 12 absents.
    expect(nums('T').has(13)).toBe(false)
    expect(nums('T').has(12)).toBe(false)
    // W : extérieur jardin amovible (6 sièges), fosse X amovible (16).
    expect(seats.filter((s) => s.rowLabel === 'W' && s.removable)).toHaveLength(6)
    expect(seats.filter((s) => s.rowLabel === 'X' && s.removable)).toHaveLength(16)
  })

  it('refuse un rang en double', () => {
    expect(() => parsePlaceNotation('A 5/1 2/4\nA 5/1 2/4')).toThrow(/double/)
  })
})
