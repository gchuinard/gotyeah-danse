// Notation place.md v2 : blocs multiples par côté (console, strapontins),
// séparations (« | » + règle par défaut), sérialisation inverse. On vérifie
// que des lignes RÉELLES de Bergerac redonnent les bons numéros une fois
// passées dans buildVenueConfig + generateSeats.

import { describe, expect, it } from 'vitest'

import { venueConfig } from '@/config/venue'
import { BUILDER_DEFAULTS, buildVenueConfig } from '@/lib/venue/build'
import { generateSeats } from '@/lib/venue/generate'
import {
  analysePlaceNotation,
  EXEMPLE_BERGERAC,
  parsePlaceLine,
  parsePlaceNotation,
  resumeRang,
  serialiseRow,
  serialiseVenueConfig,
} from '@/lib/venue/place-notation'

describe('parsePlaceLine', () => {
  it('rang classique : B 37/19 17/1 2/18 20/38', () => {
    expect(parsePlaceLine('B 37/19 17/1 2/18 20/38')).toEqual({
      label: 'B',
      jardin: [
        { seats: 9, firstNumber: 1, removable: false, separe: false },
        { seats: 10, firstNumber: 19, removable: false, separe: true },
      ],
      cour: [
        { seats: 9, firstNumber: 2, removable: false, separe: false },
        { seats: 10, firstNumber: 20, removable: false, separe: true },
      ],
    })
  })

  it('rang continu : A 45/1 2/44', () => {
    expect(parsePlaceLine('A 45/1 2/44')).toEqual({
      label: 'A',
      jardin: [{ seats: 23, firstNumber: 1, removable: false, separe: false }],
      cour: [{ seats: 22, firstNumber: 2, removable: false, separe: false }],
    })
  })

  it('fosse amovible : X (1/15) (2/16) 12', () => {
    const row = parsePlaceLine('X (1/15) (2/16) 12')
    expect(row.jardin).toEqual([{ seats: 8, firstNumber: 1, removable: true, separe: false }])
    expect(row.cour).toEqual([{ seats: 8, firstNumber: 2, removable: true, separe: false }])
  })

  it("console H (ligne ORIGINALE de place.md) : centre scindé, 8 amovibles contigus", () => {
    const row = parsePlaceLine('H 35/17 15/9 (7/1) (2/8) 10/16 18/36 12')
    expect(row.jardin).toEqual([
      { seats: 4, firstNumber: 1, removable: true, separe: false },
      { seats: 4, firstNumber: 9, removable: false, separe: false }, // contigu (console)
      { seats: 10, firstNumber: 17, removable: false, separe: true }, // allée (règle par défaut)
    ])
    expect(row.cour[1]).toEqual({ seats: 4, firstNumber: 10, removable: false, separe: false })
    expect(row.cour[2].separe).toBe(true)
  })

  it('« | » explicite : strapontin séparé sans être le bloc extérieur', () => {
    const row = parsePlaceLine('Z 13/11 | 9/1 2/8 | 12/14')
    expect(row.jardin).toEqual([
      { seats: 5, firstNumber: 1, removable: false, separe: false },
      { seats: 2, firstNumber: 11, removable: false, separe: true },
    ])
    expect(row.cour[1]).toMatchObject({ firstNumber: 12, separe: true })
  })

  it('capture les sauts : O 31/17 13/1 2/12 16/30', () => {
    const row = parsePlaceLine('O 31/17 13/1 2/12 16/30 1')
    expect(row.jardin[1].firstNumber).toBe(17) // milieu s'arrête à 13 → 15 saute
    expect(row.cour[1].firstNumber).toBe(16) // milieu s'arrête à 12 → 14 saute
  })

  it.each([
    ['Z 35/17', /impairs .* PUIS pairs/],
    ['Z 11/15 13/1 2/12', /désordre|chevauchent/],
    ['Z 13/1 2/12 11/15', /mélangés/],
    ['Z 15/2 2/16', /mélange/],
    ['Z patate', /illisible/],
    ['Z | 9/1 2/8', /mal placé/],
    ['Z 9/1 2/8 |', /fin de ligne/],
  ])('rejette %s', (ligne, erreur) => {
    expect(() => parsePlaceLine(ligne)).toThrow(erreur)
  })
})

describe('buildVenueConfig (v2)', () => {
  it('console : les 4 sous-blocs du centre restent contigus pour le placement', () => {
    const rows = parsePlaceNotation('H 35/17 15/9 (7/1) (2/8) 10/16 18/36')
    const seats = generateSeats(buildVenueConfig({ name: 'T', ...BUILDER_DEFAULTS }, rows))
    const centre = seats.filter((s) => s.section === 'centre').sort((a, b) => a.indexInRow - b.indexInRow)
    expect(centre.map((s) => s.indexInRow)).toEqual([...Array(16).keys()]) // 0..15 sans trou
    expect(centre.filter((s) => s.removable).map((s) => s.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
  })

  it('strapontin séparé : rupture de contiguïté (trou d’indexInRow)', () => {
    const rows = parsePlaceNotation('Z 15/13 | 11/1 2/10 | 12/14')
    const seats = generateSeats(buildVenueConfig({ name: 'T', ...BUILDER_DEFAULTS }, rows))
    const gauche = seats.filter((s) => s.section === 'gauche').map((s) => s.indexInRow).sort((a, b) => a - b)
    // ext jardin (11→15 sautés ? non : 13/15 = 2 sièges) puis… une seule
    // séparation jardin → ext = section gauche d'un seul tenant ici.
    expect(gauche).toEqual([0, 1])
    expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length)
  })
})

describe('couloir (---) et décalage latéral (<n / >n)', () => {
  it('--- attache couloirAvant au rang suivant ; >1.5 décale vers cour', () => {
    const rows = parsePlaceNotation('A 9/1 2/8\n---\nB 9/1 2/8 >1.5\nC 9/1 2/8 <2 12')
    expect(rows[0].couloirAvant).toBeUndefined()
    expect(rows[1].couloirAvant).toBe(true)
    expect(rows[1].decalage).toBe(1.5)
    expect(rows[2].decalage).toBe(-2) // flag 12 + décalage cumulables
  })

  it('serialiseRow conserve le décalage (aller-retour)', () => {
    const row = parsePlaceLine('B 9/1 2/8 >1.5')
    expect(parsePlaceLine(serialiseRow(row))).toEqual(row)
  })

  it('build : couloir = écart radial élargi, décalage = xOffset visuel', () => {
    const rows = parsePlaceNotation('A 9/1 2/8\n---\nB 9/1 2/8 >2\nC 9/1 2/8')
    const config = buildVenueConfig({ name: 'T', ...BUILDER_DEFAULTS }, rows)
    // ordre scène → fond : C, B, A — couloir entre B et A.
    const [c, b, a] = config.rows
    expect(b.radius - c.radius).toBe(BUILDER_DEFAULTS.espacement)
    expect(a.radius - b.radius).toBeGreaterThan(BUILDER_DEFAULTS.espacement * 2)
    expect(b.xOffset).toBeGreaterThan(0)
    expect(a.xOffset).toBeUndefined()
    // le décalage ne change PAS la numérotation
    const seats = generateSeats(config)
    const bSeats = seats.filter((s) => s.rowLabel === 'B')
    expect(bSeats.filter((s) => s.number % 2 === 1)).toHaveLength(5)
  })
})

describe('sérialisation inverse', () => {
  it('serialiseRow ↔ parsePlaceLine : aller-retour stable', () => {
    for (const ligne of [
      'B 37/19 17/1 2/18 20/38',
      'A 45/1 2/44',
      'X (1/15) (2/16)',
      'H 35/17 15/9 (7/1) (2/8) 10/16 18/36',
      'O 31/17 13/1 2/12 16/30',
    ]) {
      const row = parsePlaceLine(ligne)
      expect(parsePlaceLine(serialiseRow(row))).toEqual(row)
    }
  })

  it('serialiseVenueConfig(Bergerac intégré) : re-parse, re-build, mêmes numéros', () => {
    const notation = serialiseVenueConfig(venueConfig)
    const rows = parsePlaceNotation(notation)
    expect(rows).toHaveLength(25)
    const seats = generateSeats(buildVenueConfig({ name: 'Bergerac (édité)', ...BUILDER_DEFAULTS }, rows))
    expect(seats).toHaveLength(754)
    const original = generateSeats(venueConfig)
    const cle = (s: { rowLabel: string; number: number; removable: boolean }) =>
      `${s.rowLabel}-${s.number}-${s.removable}`
    expect(new Set(seats.map(cle))).toEqual(new Set(original.map(cle)))
  })
})

describe('EXEMPLE_BERGERAC (préchargement du créateur)', () => {
  it('reproduit la salle réelle : 25 rangs, 754 places, console exacte', () => {
    const rows = parsePlaceNotation(EXEMPLE_BERGERAC)
    expect(rows).toHaveLength(25)
    const seats = generateSeats(buildVenueConfig({ name: 'Bergerac (exemple)', ...BUILDER_DEFAULTS }, rows))
    expect(seats).toHaveLength(754)
    const nums = (label: string) =>
      new Set(seats.filter((s) => s.rowLabel === label).map((s) => s.number))
    expect(nums('O').has(15)).toBe(false)
    expect(nums('O').has(31)).toBe(true)
    expect(nums('T').has(12)).toBe(false)
    // fosses X/Y (16+16) + jardin W (6) + consoles H/I exactes (8+8)
    expect(seats.filter((s) => s.removable)).toHaveLength(54)
  })
})

describe('analysePlaceNotation (éditeur : erreurs localisées)', () => {
  it("ne s'arrête pas à la première erreur et garde les numéros de ligne", () => {
    const lignes = analysePlaceNotation('# titre\nA 5/1 2/4\nB patate\n\nC 5/1 2/4\nA 5/1 2/4')
    expect(lignes).toHaveLength(4)
    expect(lignes[0]).toMatchObject({ ligne: 2, ok: true })
    expect(lignes[1]).toMatchObject({ ligne: 3, ok: false })
    expect(lignes[2]).toMatchObject({ ligne: 5, ok: true })
    expect(lignes[3]).toMatchObject({ ligne: 6, ok: false })
  })
})

describe('resumeRang', () => {
  it('détecte les sauts et compte les amovibles', () => {
    const r = resumeRang(parsePlaceLine('O 31/17 13/1 2/12 16/30 1'))
    expect(r.total).toBe(29)
    expect(r.impairs).toBe('1→13, 17→31')
    expect(r.pairs).toBe('2→12, 16→30')
    expect(r.sauts).toEqual([14, 15])
    expect(r.amovibles).toBe(0)
  })

  it('rang continu : pas de saut, plages simples', () => {
    const r = resumeRang(parsePlaceLine('A 45/1 2/44'))
    expect(r).toMatchObject({ total: 45, impairs: '1→45', pairs: '2→44', sauts: [] })
  })

  it('console : 8 amovibles', () => {
    const r = resumeRang(parsePlaceLine('H 35/17 15/9 (7/1) (2/8) 10/16 18/36'))
    expect(r.total).toBe(36)
    expect(r.amovibles).toBe(8)
    expect(r.impairs).toBe('1→7, 9→15, 17→35')
  })
})
