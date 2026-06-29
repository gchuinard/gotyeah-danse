// Construction d'une VenueConfig depuis un relevé place.md + paramètres de
// géométrie (buildVenueConfig). On vérifie que la sortie est STRUCTURELLEMENT
// correcte, qu'elle PASSE le schéma zod de la salle, et que la géométrie
// (rayons, angles, allées, décalages) suit bien les paramètres — module PUR,
// sans DB.

import { describe, expect, it } from 'vitest'

import type { VenueConfig } from '@/config/venue'
import { BUILDER_DEFAULTS, buildVenueConfig } from '@/lib/venue/build'
import { generateSeats } from '@/lib/venue/generate'
import { EXEMPLE_BERGERAC, parsePlaceNotation } from '@/lib/venue/place-notation'
import { parseVenueConfig, venueConfigSchema } from '@/lib/venue/schema'

// Paramètres complets (BUILDER_DEFAULTS omet volontairement le name).
const PARAMS = { name: 'Salle Test', ...BUILDER_DEFAULTS }

type PerRow = Map<string, { seatPitch?: number; aisleWidth?: number }>

// Raccourci : relevé texte → VenueConfig.
const build = (texte: string, perRow?: PerRow): VenueConfig =>
  buildVenueConfig(PARAMS, parsePlaceNotation(texte), perRow)

// Aller-retour JSON (comme un fichier de salle chargé) avant validation zod.
const roundtrip = (cfg: VenueConfig) => JSON.parse(JSON.stringify(cfg))

// Même dérivation que le module : l'angle d'une longueur se déduit du rayon.
const degParPx = (radius: number) => 180 / (Math.PI * radius)

describe('BUILDER_DEFAULTS', () => {
  it('valeurs de géométrie positives et cohérentes', () => {
    expect(BUILDER_DEFAULTS.premierRayon).toBeGreaterThan(0)
    expect(BUILDER_DEFAULTS.espacement).toBeGreaterThan(0)
    expect(BUILDER_DEFAULTS.seatPitch).toBeGreaterThan(0)
    expect(BUILDER_DEFAULTS.aisleWidth).toBeGreaterThan(0)
    // une allée est plus large qu'un fauteuil
    expect(BUILDER_DEFAULTS.aisleWidth).toBeGreaterThan(BUILDER_DEFAULTS.seatPitch)
    // le premier rayon dépasse largement l'espacement entre rangs
    expect(BUILDER_DEFAULTS.premierRayon).toBeGreaterThan(BUILDER_DEFAULTS.espacement)
  })

  it('ne porte pas de name (Omit<BuilderParams, "name">)', () => {
    expect('name' in BUILDER_DEFAULTS).toBe(false)
  })
})

describe('buildVenueConfig — structure de base', () => {
  it('center à l’origine, numérotation pair-impair, name transmis', () => {
    const cfg = build('A 9/1 2/8')
    expect(cfg.center).toEqual({ x: 0, y: 0 })
    expect(cfg.numberingScheme).toBe('pair-impair')
    expect(cfg.name).toBe('Salle Test')
  })

  it('un rang → une row, label conservé, radius = premierRayon', () => {
    const cfg = build('A 9/1 2/8')
    expect(cfg.rows).toHaveLength(1)
    expect(cfg.rows[0].label).toBe('A')
    expect(cfg.rows[0].radius).toBe(BUILDER_DEFAULTS.premierRayon)
  })

  it('nombre de rows = nombre de rangs du relevé', () => {
    expect(build('A 9/1 2/8\nB 9/1 2/8\nC 9/1 2/8').rows).toHaveLength(3)
  })
})

describe('buildVenueConfig — ordre & rayons', () => {
  it('inverse l’ordre : le DERNIER rang du relevé (scène) devient rowOrder 0', () => {
    // relevé fond→scène : A (fond) puis B (scène) → config scène→fond : [B, A]
    const cfg = build('A 9/1 2/8\nB 11/1 2/10')
    expect(cfg.rows.map((r) => r.label)).toEqual(['B', 'A'])
    expect(cfg.rows[0].radius).toBe(BUILDER_DEFAULTS.premierRayon)
  })

  it('espacement constant entre rangs (sans couloir), rayons strictement croissants', () => {
    const radii = build('A 9/1 2/8\nB 9/1 2/8\nC 9/1 2/8').rows.map((r) => r.radius)
    expect(radii).toEqual([900, 945, 990])
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i] - radii[i - 1]).toBe(BUILDER_DEFAULTS.espacement)
      expect(radii[i]).toBeGreaterThan(radii[i - 1])
    }
  })

  it('un couloir (---) élargit l’écart radial (× 2,4)', () => {
    // après inversion : [C (scène), B (couloir devant), A (fond)]
    const [c, b, a] = build('A 9/1 2/8\n---\nB 9/1 2/8\nC 9/1 2/8').rows
    expect(b.radius - c.radius).toBe(BUILDER_DEFAULTS.espacement)
    expect(a.radius - b.radius).toBeCloseTo(BUILDER_DEFAULTS.espacement * 2.4, 6)
  })

  it('respecte des paramètres de géométrie personnalisés', () => {
    const cfg = buildVenueConfig(
      { name: 'Z', premierRayon: 1200, espacement: 60, seatPitch: 20, aisleWidth: 50 },
      parsePlaceNotation('A 9/1 2/8\nB 9/1 2/8'),
    )
    expect(cfg.rows.map((r) => r.radius)).toEqual([1200, 1260])
    expect(cfg.name).toBe('Z')
  })
})

describe('buildVenueConfig — conformité au schéma zod', () => {
  it('rang classique : config valide', () => {
    expect(() => parseVenueConfig(roundtrip(build('B 37/19 17/1 2/18 20/38')), 'test')).not.toThrow()
  })

  it('console (centre scindé, amovibles contigus) : config valide', () => {
    expect(() =>
      parseVenueConfig(roundtrip(build('H 35/17 15/9 (7/1) (2/8) 10/16 18/36')), 'test'),
    ).not.toThrow()
  })

  it('fosse entièrement amovible : config valide', () => {
    expect(() => parseVenueConfig(roundtrip(build('X (1/15) (2/16)')), 'test')).not.toThrow()
  })

  it('relevé complet de Bergerac (25 rangs, 754 places) : config valide', () => {
    const cfg = build(EXEMPLE_BERGERAC)
    expect(cfg.rows).toHaveLength(25)
    expect(cfg.rows[0].label).toBe('Y') // collé à la scène
    expect(cfg.rows[cfg.rows.length - 1].label).toBe('A') // tout au fond
    expect(() => parseVenueConfig(roundtrip(cfg), 'bergerac')).not.toThrow()
    expect(generateSeats(cfg)).toHaveLength(754)
  })

  it('tableau de rangs vide : pas d’exception, mais schéma rejette (≥ 1 row)', () => {
    const cfg = buildVenueConfig(PARAMS, [])
    expect(cfg.rows).toHaveLength(0)
    expect(venueConfigSchema.safeParse(roundtrip(cfg)).success).toBe(false)
  })
})

describe('buildVenueConfig — géométrie des arcs', () => {
  it('pas angulaire dérivé du rayon : centre à ± un demi-pas de l’axe', () => {
    const cfg = build('A 9/1 2/8')
    const pitchDeg = BUILDER_DEFAULTS.seatPitch * degParPx(BUILDER_DEFAULTS.premierRayon)
    const arcs = cfg.rows[0].arcs
    const centreJardin = arcs.find((a) => a.section === 'centre' && a.angleStart < 0)!
    const centreCour = arcs.find((a) => a.section === 'centre' && a.angleStart > 0)!
    expect(centreJardin.angleEnd).toBeCloseTo(-0.5 * pitchDeg, 6)
    expect(centreCour.angleStart).toBeCloseTo(0.5 * pitchDeg, 6)
    // bloc jardin de 5 sièges : bord mur à -(5 − 0,5) pas
    expect(centreJardin.angleStart).toBeCloseTo(-4.5 * pitchDeg, 6)
  })

  it('jardin côté négatif, cour côté positif ; bornes dans ]-90, 90[', () => {
    const arcs = build('B 37/19 17/1 2/18 20/38').rows[0].arcs
    for (const arc of arcs) {
      expect(arc.angleStart).toBeGreaterThan(-90)
      expect(arc.angleEnd).toBeLessThan(90)
      if (arc.seats > 1) expect(arc.angleStart).toBeLessThan(arc.angleEnd)
    }
    expect(arcs.find((a) => a.section === 'gauche')!.angleEnd).toBeLessThan(0)
    expect(arcs.find((a) => a.section === 'droite')!.angleStart).toBeGreaterThan(0)
  })

  it('somme des seats des arcs = total des places du rang', () => {
    const cfg = build('B 37/19 17/1 2/18 20/38') // 19 impairs + 19 pairs = 38
    expect(cfg.rows[0].arcs.reduce((n, a) => n + a.seats, 0)).toBe(38)
    expect(generateSeats(cfg)).toHaveLength(38)
  })

  it('nombre d’arcs selon le rang : ext + centre×2', () => {
    expect(build('B 37/19 17/1 2/18 20/38').rows[0].arcs).toHaveLength(4) // 2 ext + 2 demi-centres
    expect(build('A 9/1 2/8').rows[0].arcs).toHaveLength(2) // pas d'ext : 2 demi-centres
    expect(build('X (1/15) (2/16)').rows[0].arcs).toHaveLength(2)
  })

  it('arc minimal (1 siège) : angleStart === angleEnd, accepté par le schéma', () => {
    const cfg = build('A 1/1 2/2')
    for (const arc of cfg.rows[0].arcs) {
      expect(arc.seats).toBe(1)
      expect(arc.angleStart).toBe(arc.angleEnd)
    }
    expect(venueConfigSchema.safeParse(roundtrip(cfg)).success).toBe(true)
  })
})

describe('buildVenueConfig — sections, numérotation, amovibles, contiguïté', () => {
  it('blocs extérieurs : sections gauche/droite + firstNumber des sauts', () => {
    const arcs = build('B 37/19 17/1 2/18 20/38').rows[0].arcs
    expect(arcs.find((a) => a.section === 'gauche')!.firstNumber).toBe(19)
    expect(arcs.find((a) => a.section === 'droite')!.firstNumber).toBe(20)
  })

  it('bloc le plus proche de l’axe : pas de firstNumber', () => {
    const arcs = build('B 37/19 17/1 2/18 20/38').rows[0].arcs
    for (const centre of arcs.filter((a) => a.section === 'centre')) {
      expect(centre.firstNumber).toBeUndefined()
    }
  })

  it('1er bloc cour contigu au centre jardin (assise possible à cheval sur l’axe)', () => {
    const arcs = build('A 9/1 2/8').rows[0].arcs
    const centreCour = arcs.find((a) => a.section === 'centre' && a.angleStart > 0)!
    const centreJardin = arcs.find((a) => a.section === 'centre' && a.angleStart < 0)!
    expect(centreCour.contiguousWithPrevious).toBe(true)
    expect(centreJardin.contiguousWithPrevious).toBeUndefined()
  })

  it('blocs extérieurs séparés par l’allée : non contigus ; classique = 1 jointure', () => {
    const arcs = build('B 37/19 17/1 2/18 20/38').rows[0].arcs
    expect(arcs.find((a) => a.section === 'gauche')!.contiguousWithPrevious).toBeUndefined()
    expect(arcs.find((a) => a.section === 'droite')!.contiguousWithPrevious).toBeUndefined()
    expect(arcs.filter((a) => a.contiguousWithPrevious).length).toBe(1)
  })

  it('fosse amovible : flag removable propagé ; rang normal sans flag', () => {
    expect(build('X (1/15) (2/16)').rows[0].arcs.every((a) => a.removable === true)).toBe(true)
    expect(build('A 9/1 2/8').rows[0].arcs.every((a) => a.removable === undefined)).toBe(true)
  })

  it('console : sous-blocs centraux contigus (≥ 2 jointures) + amovibles', () => {
    const arcs = build('H 35/17 15/9 (7/1) (2/8) 10/16 18/36').rows[0].arcs
    expect(arcs.filter((a) => a.contiguousWithPrevious).length).toBeGreaterThanOrEqual(2)
    expect(arcs.some((a) => a.removable)).toBe(true)
  })
})

describe('buildVenueConfig — décalage latéral (xOffset)', () => {
  it('décalage > 0 (vers cour) → xOffset = décalage × seatPitch (px)', () => {
    expect(build('B 9/1 2/8 >1.5').rows[0].xOffset).toBe(1.5 * BUILDER_DEFAULTS.seatPitch) // 33
  })

  it('décalage < 0 (vers jardin) → xOffset négatif', () => {
    expect(build('C 9/1 2/8 <2').rows[0].xOffset).toBe(-2 * BUILDER_DEFAULTS.seatPitch) // -44
  })

  it('aucun décalage → pas de xOffset', () => {
    expect(build('A 9/1 2/8').rows[0].xOffset).toBeUndefined()
  })
})

describe('buildVenueConfig — surcharges perRow', () => {
  // angle de référence d'un rang : bord mur du demi-centre jardin
  const angle = (cfg: VenueConfig, label: string) =>
    cfg.rows
      .find((r) => r.label === label)!
      .arcs.find((a) => a.section === 'centre' && a.angleStart < 0)!.angleStart

  it('seatPitch surchargé : angles mis à l’échelle, autres rangs inchangés', () => {
    const texte = 'A 9/1 2/8\nB 9/1 2/8' // config : [B, A]
    const base = build(texte)
    const surcharge = build(texte, new Map([['B', { seatPitch: BUILDER_DEFAULTS.seatPitch * 2 }]]))
    // B (pas doublé) : angle doublé
    expect(angle(surcharge, 'B')).toBeCloseTo(angle(base, 'B') * 2, 6)
    // A (non surchargé) : strictement identique
    expect(angle(surcharge, 'A')).toBe(angle(base, 'A'))
  })

  it('aisleWidth surchargé : l’allée s’élargit', () => {
    const texte = 'A 15/13 11/1 2/10 12/14'
    const gap = (cfg: VenueConfig) => {
      const arcs = cfg.rows[0].arcs
      const centreJardin = arcs.find((a) => a.section === 'centre' && a.angleStart < 0)!
      const extJardin = arcs.find((a) => a.section === 'gauche')!
      return Math.abs(centreJardin.angleStart - extJardin.angleEnd)
    }
    const base = build(texte)
    const large = build(texte, new Map([['A', { aisleWidth: BUILDER_DEFAULTS.aisleWidth * 3 }]]))
    expect(gap(large)).toBeGreaterThan(gap(base))
  })

  it('seatPitch surchargé impacte aussi le xOffset (px = décalage × pitch)', () => {
    expect(build('B 9/1 2/8 >1.5', new Map([['B', { seatPitch: 10 }]])).rows[0].xOffset).toBe(15)
  })

  it('label absent de la Map : géométrie globale appliquée', () => {
    const sansMap = build('A 9/1 2/8')
    const mapAutre = build('A 9/1 2/8', new Map([['ZZ', { seatPitch: 99 }]]))
    expect(mapAutre.rows[0].arcs).toEqual(sansMap.rows[0].arcs)
  })
})
