// Point d'entrée du placement (lib/placement/index.ts) : choix de
// l'implémentation. La garantie qui compte : `getPlacement` renvoie la BONNE
// fonction selon l'argument explicite OU la variable d'env PLACEMENT_IMPL, le
// défaut étant le moteur intelligent (custom). On vérifie l'aiguillage par
// IDENTITÉ avec les deux moteurs réels, puis quelques fumées de comportement.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getPlacement, PLACEMENT_IMPLS } from '@/lib/placement'
import type { PlacementImpl, SeatState } from '@/lib/placement'
import { suggestPlacement as baselineFn } from '@/lib/placement/baseline'
import { implemented as customImplemented, suggestPlacement as customFn } from '@/lib/placement/custom'
import { row, shuffleSeede } from './helpers'

// ── Fixtures lisibles ──────────────────────────────────────────────────────

// Une rangée centrale de 4 sièges libres : de quoi placer un duo.
const RANGEE_4 = row({ rowId: 'centre-A', section: 'centre', rowOrder: 0, indexes: [0, 1, 2, 3] })
// Une rangée de 5 sièges : test de déterminisme (groupe de 3).
const RANGEE_5 = row({ rowId: 'centre-A', section: 'centre', rowOrder: 0, indexes: [0, 1, 2, 3, 4] })
// Une rangée de 2 sièges, seule : un groupe de 3 n'y tient pas (ni fenêtre, ni
// bloc faute d'un second rang) → résultat vide pour les deux moteurs.
const RANGEE_2 = row({ rowId: 'centre-A', section: 'centre', rowOrder: 0, indexes: [0, 1] })

// ── Hygiène d'environnement : on isole et on RESTAURE PLACEMENT_IMPL ─────────

const ENV_ORIG = process.env.PLACEMENT_IMPL

// Chaque test démarre sans PLACEMENT_IMPL ; ceux qui en ont besoin le posent.
beforeEach(() => {
  delete process.env.PLACEMENT_IMPL
})

// On remet la valeur d'origine telle quelle (y compris « absente »).
afterAll(() => {
  if (ENV_ORIG === undefined) delete process.env.PLACEMENT_IMPL
  else process.env.PLACEMENT_IMPL = ENV_ORIG
})

// ── Catalogue des implémentations ───────────────────────────────────────────

describe('PLACEMENT_IMPLS', () => {
  it('expose EXACTEMENT les deux moteurs : baseline et custom', () => {
    expect(Object.keys(PLACEMENT_IMPLS).sort()).toEqual(['baseline', 'custom'])
  })

  it('baseline : fonction = moteur baseline réel, implemented = true', () => {
    expect(PLACEMENT_IMPLS.baseline.fn).toBe(baselineFn)
    expect(PLACEMENT_IMPLS.baseline.implemented).toBe(true)
  })

  it('custom : fonction = moteur custom réel, implemented = drapeau du module', () => {
    expect(PLACEMENT_IMPLS.custom.fn).toBe(customFn)
    // On se cale sur le drapeau exporté par le module plutôt qu'une constante en
    // dur : le test reste juste si la valeur évolue (custom est actif ici).
    expect(PLACEMENT_IMPLS.custom.implemented).toBe(customImplemented)
  })
})

// ── Aiguillage de getPlacement (argument + env) ─────────────────────────────

describe('getPlacement — choix de l’implémentation', () => {
  it('défaut (aucun argument, PLACEMENT_IMPL absent) → custom', () => {
    expect(getPlacement()).toBe(customFn)
  })

  it('argument explicite « custom » → custom', () => {
    expect(getPlacement('custom')).toBe(customFn)
  })

  it('argument explicite « baseline » → baseline', () => {
    expect(getPlacement('baseline')).toBe(baselineFn)
  })

  it('PLACEMENT_IMPL=baseline → baseline', () => {
    process.env.PLACEMENT_IMPL = 'baseline'
    expect(getPlacement()).toBe(baselineFn)
  })

  it('PLACEMENT_IMPL=custom → custom', () => {
    process.env.PLACEMENT_IMPL = 'custom'
    expect(getPlacement()).toBe(customFn)
  })

  it('PLACEMENT_IMPL ≠ « baseline » (comparaison stricte) → custom', () => {
    // Seule la valeur exacte « baseline » bascule ; casse et valeurs parasites
    // retombent sur le défaut custom.
    process.env.PLACEMENT_IMPL = 'BASELINE'
    expect(getPlacement()).toBe(customFn)
    process.env.PLACEMENT_IMPL = 'nimporte-quoi'
    expect(getPlacement()).toBe(customFn)
    process.env.PLACEMENT_IMPL = ''
    expect(getPlacement()).toBe(customFn)
  })

  it('l’argument explicite PRIME sur PLACEMENT_IMPL', () => {
    process.env.PLACEMENT_IMPL = 'baseline'
    expect(getPlacement('custom')).toBe(customFn) // l'argument gagne
    process.env.PLACEMENT_IMPL = 'custom'
    expect(getPlacement('baseline')).toBe(baselineFn) // l'argument gagne
  })

  it('implémentation inconnue → lève (aucune validation, accès direct)', () => {
    // PLACEMENT_IMPLS[choice] est undefined → lecture de .fn impossible.
    expect(() => getPlacement('nope' as PlacementImpl)).toThrow()
  })
})

// ── Fumées de comportement : la fonction renvoyée place réellement ──────────

describe('getPlacement — la fonction renvoyée place un groupe', () => {
  // Vérifie la forme d'une liste de suggestions (≤ 3, chacune de `partySize`
  // sièges libres et existants, score numérique).
  function attendSuggestionsValides(seats: SeatState[], partySize: number, fn = getPlacement()) {
    const out = fn(seats, partySize)
    const parId = new Map(seats.map((s) => [s.id, s]))
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out.length).toBeLessThanOrEqual(3)
    for (const sug of out) {
      expect(sug.seatIds).toHaveLength(partySize)
      expect(typeof sug.score).toBe('number')
      for (const id of sug.seatIds) {
        const s = parId.get(id)
        expect(s, `siège inconnu : ${id}`).toBeDefined()
        expect(s!.free).toBe(true)
      }
    }
  }

  it('défaut (custom) : place un duo sur une rangée de 4', () => {
    attendSuggestionsValides(RANGEE_4, 2)
  })

  it('baseline : place aussi un duo sur la même rangée', () => {
    attendSuggestionsValides(RANGEE_4, 2, getPlacement('baseline'))
  })

  it('groupe impossible (3 sur une rangée de 2) → [] pour les deux moteurs', () => {
    expect(getPlacement('custom')(RANGEE_2, 3)).toEqual([])
    expect(getPlacement('baseline')(RANGEE_2, 3)).toEqual([])
  })

  it('partySize invalide (0) → [] pour les deux moteurs', () => {
    expect(getPlacement('custom')(RANGEE_4, 0)).toEqual([])
    expect(getPlacement('baseline')(RANGEE_4, 0)).toEqual([])
  })

  it('déterministe : l’ordre du tableau d’entrée n’influe pas (custom)', () => {
    const fn = getPlacement('custom')
    const melange = shuffleSeede(RANGEE_5, 42)
    expect(fn(melange, 3)).toEqual(fn(RANGEE_5, 3))
  })
})
