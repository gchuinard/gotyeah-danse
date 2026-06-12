// Tests d'invariants du moteur de placement — voir lib/placement/types.ts.
//
// Suite GÉNÉRIQUE : la même batterie tourne sur chaque implémentation de
// PLACEMENT_IMPLS. La suite `custom` est skippée tant que `implemented`
// reste à false, et s'activera automatiquement quand il passera à true.
//
// RÈGLE D'OR : ces tests ne contiennent AUCUN algorithme de placement,
// ils ne font que vérifier le contrat des implémentations existantes.

import { describe, expect, it } from 'vitest'

import { PLACEMENT_IMPLS } from '@/lib/placement'
import type { SeatState, Suggestion } from '@/lib/placement/types'
import { row, salleReelle, shuffleSeede } from './helpers'

// ── Vérification générique des invariants 1 à 4 ────────────────────────────

function verifieInvariants(seats: SeatState[], partySize: number, suggestions: Suggestion[]) {
  const parId = new Map(seats.map((s) => [s.id, s]))

  // Invariant 1 : au plus 3 suggestions, triées de la meilleure à la moins
  // bonne. L'ordre « meilleure → moins bonne » est le classement PROPRE à
  // l'implémentation (position dans le tableau retourné) : la baseline classe
  // par ordre de lecture et ignore volontairement le score statique
  // (PLACEMENT.md §4), donc le champ `score` n'est PAS garanti décroissant.
  // Seule la borne « au plus 3 » est vérifiable structurellement.
  expect(suggestions.length).toBeLessThanOrEqual(3)

  for (const suggestion of suggestions) {
    // Invariant 2 : exactement partySize sièges, distincts, existants, libres.
    expect(suggestion.seatIds).toHaveLength(partySize)
    expect(new Set(suggestion.seatIds).size).toBe(partySize)
    const sieges = suggestion.seatIds.map((id) => {
      const s = parId.get(id)
      expect(s, `siège inconnu : ${id}`).toBeDefined()
      return s!
    })
    for (const s of sieges) {
      expect(s.free, `siège occupé proposé : ${s.id}`).toBe(true)
    }

    // Invariant 3 : par rowId, indexInRow consécutifs (aucun trou).
    const parRangee = new Map<string, SeatState[]>()
    for (const s of sieges) {
      const groupe = parRangee.get(s.rowId)
      if (groupe) groupe.push(s)
      else parRangee.set(s.rowId, [s])
    }
    for (const groupe of parRangee.values()) {
      const indexes = groupe.map((s) => s.indexInRow).sort((a, b) => a - b)
      for (let i = 1; i < indexes.length; i++) {
        expect(indexes[i], `trou dans la rangée ${groupe[0].rowId}`).toBe(indexes[i - 1] + 1)
      }
    }

    // Invariant 4 : K rangées de la MÊME section, rowOrder CONSÉCUTIFS, dont
    // les plages d'indexInRow partagent une colonne commune (bloc vertical).
    const groupes = [...parRangee.values()]
    if (groupes.length >= 2) {
      const sections = new Set(groupes.map((g) => g[0].section))
      expect(sections.size, 'bloc à cheval sur plusieurs sections').toBe(1)

      const ordres = groupes.map((g) => g[0].rowOrder).sort((x, y) => x - y)
      for (let i = 1; i < ordres.length; i++) {
        expect(ordres[i], 'rangées du bloc non consécutives').toBe(ordres[i - 1] + 1)
      }

      let lo = -Infinity
      let hi = Infinity
      for (const g of groupes) {
        const idx = g.map((s) => s.indexInRow)
        lo = Math.max(lo, Math.min(...idx))
        hi = Math.min(hi, Math.max(...idx))
      }
      expect(lo <= hi, 'pas de colonne commune à toutes les rangées du bloc').toBe(true)
    }
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

// Petite salle artisanale : trous, sections différentes sur la même rangée
// physique (rowIds distincts → jamais contigus entre eux), sièges occupés.
function petiteSalle(): SeatState[] {
  return [
    // gauche-X et centre-X partagent rowOrder 0 mais sont des rowIds distincts.
    ...row({ rowId: 'gauche-X', section: 'gauche', rowOrder: 0, indexes: [0, 1, 2, 3] }),
    ...row({
      rowId: 'centre-X',
      section: 'centre',
      rowOrder: 0,
      indexes: [0, 1, 2, 3, 4, 5],
      occupied: [2],
    }),
    // Trou physique à l'index 2 (siège retiré du plan).
    ...row({ rowId: 'centre-Y', section: 'centre', rowOrder: 1, indexes: [0, 1, 3, 4, 5] }),
    ...row({ rowId: 'droite-X', section: 'droite', rowOrder: 0, indexes: [0, 1, 2], occupied: [0] }),
  ]
}

const TAILLES_DE_GROUPE = [1, 2, 3, 4, 5, 6, 7, 8, 12, 20]

// Sanity check de la fixture réelle, indépendant des implémentations.
describe('fixture salle réelle', () => {
  it('contient les 754 sièges de la fiche technique', () => {
    expect(salleReelle()).toHaveLength(754)
  })
})

// ── Suite générique, paramétrée sur les implémentations ─────────────────────

for (const [nom, meta] of Object.entries(PLACEMENT_IMPLS)) {
  describe.skipIf(!meta.implemented)(`placement « ${nom} »`, () => {
    const place = meta.fn

    // Scénarios construits à la demande pour éviter tout partage d'état.
    const scenarios: Array<[string, () => SeatState[]]> = [
      ['petite salle artisanale', petiteSalle],
      ['salle réelle entièrement libre', () => salleReelle()],
      ['salle réelle, un siège sur trois occupé', () => salleReelle((_id, i) => i % 3 !== 0)],
      ['salle réelle, un siège sur deux occupé', () => salleReelle((_id, i) => i % 2 !== 0)],
    ]

    for (const [description, construire] of scenarios) {
      describe(description, () => {
        for (const partySize of TAILLES_DE_GROUPE) {
          it(`respecte les invariants 1-4 pour partySize=${partySize}`, () => {
            const seats = construire()
            verifieInvariants(seats, partySize, place(seats, partySize))
          })
        }
      })
    }

    describe('invariant 5 — déterminisme', () => {
      it('donne le même résultat sur la salle complète mélangée (shuffle seedé)', () => {
        const base = salleReelle((_id, i) => i % 3 !== 0)
        for (const partySize of TAILLES_DE_GROUPE) {
          const attendu = place(base, partySize)
          expect(place(shuffleSeede(base, 42), partySize)).toEqual(attendu)
          expect(place(shuffleSeede(base, 1337), partySize)).toEqual(attendu)
        }
      })

      it('donne le même résultat sur le tableau inversé', () => {
        const base = salleReelle()
        const inverse = [...base].reverse()
        for (const partySize of TAILLES_DE_GROUPE) {
          expect(place(inverse, partySize)).toEqual(place(base, partySize))
        }
      })
    })

    describe('non-mutation de l’entrée', () => {
      it('ne modifie ni le tableau ni les sièges', () => {
        const seats = salleReelle((_id, i) => i % 4 !== 1)
        const avant = structuredClone(seats)
        for (const partySize of TAILLES_DE_GROUPE) {
          place(seats, partySize)
        }
        expect(seats).toEqual(avant)
      })
    })

    describe('cas limites', () => {
      it('partySize = 0 → aucune suggestion', () => {
        expect(place(salleReelle(), 0)).toEqual([])
      })

      it('partySize négatif → aucune suggestion', () => {
        expect(place(salleReelle(), -3)).toEqual([])
      })

      it('salle entièrement occupée → aucune suggestion', () => {
        const pleine = salleReelle(() => false)
        for (const partySize of TAILLES_DE_GROUPE) {
          expect(place(pleine, partySize)).toEqual([])
        }
      })

      it('grand groupe (46) → bloc multi-rangs ou vide, invariants respectés', () => {
        // Plus longue rangée : 45 sièges (rang A). 46 passe en bloc multi-rangs
        // (ex. colonnes centrales sur plusieurs rangs) : on ne force pas le
        // vide, on vérifie les invariants sur ce qui est retourné.
        const seats = salleReelle()
        verifieInvariants(seats, 46, place(seats, 46))
      })

      it('groupe plus grand que la salle (partySize=755) → aucune suggestion', () => {
        // 754 sièges au total : 755 ne peut jamais être proposé, le résultat
        // DOIT être vide.
        expect(place(salleReelle(), 755)).toEqual([])
      })
    })

    describe('les sièges occupés ne sont jamais proposés', () => {
      // Fixture vérifiable à la main : deux rangées centre adjacentes.
      //  centre-A (rowOrder 0) : 6 sièges, l'index 2 est occupé → libres 0-1 et 3-5
      //  centre-B (rowOrder 1) : 6 sièges, les index 0 et 1 occupés → libres 2-5
      const construire = () => [
        ...row({
          rowId: 'centre-A',
          section: 'centre',
          rowOrder: 0,
          indexes: [0, 1, 2, 3, 4, 5],
          occupied: [2],
        }),
        ...row({
          rowId: 'centre-B',
          section: 'centre',
          rowOrder: 1,
          indexes: [0, 1, 2, 3, 4, 5],
          occupied: [0, 1],
        }),
      ]
      const occupes = ['centre-A-02', 'centre-B-00', 'centre-B-01']

      for (const partySize of TAILLES_DE_GROUPE) {
        it(`aucun siège occupé dans les suggestions pour partySize=${partySize}`, () => {
          const seats = construire()
          const suggestions = place(seats, partySize)
          verifieInvariants(seats, partySize, suggestions)
          for (const suggestion of suggestions) {
            for (const id of occupes) {
              expect(suggestion.seatIds).not.toContain(id)
            }
          }
        })
      }

      it('rangée isolée : la fenêtre contourne les occupés', () => {
        // Rangée seule (pas de rangée adjacente → scission impossible) :
        // 8 sièges, index 2 et 5 occupés → fenêtres libres [0,1], [3,4], [6,7].
        const seats = row({
          rowId: 'centre-Z',
          section: 'centre',
          rowOrder: 0,
          indexes: [0, 1, 2, 3, 4, 5, 6, 7],
          occupied: [2, 5],
        })
        const fenetresValides = ['0-1', '3-4', '6-7']
        const suggestions = place(seats, 2)
        verifieInvariants(seats, 2, suggestions)
        for (const suggestion of suggestions) {
          const indexes = suggestion.seatIds
            .map((id) => seats.find((s) => s.id === id)!.indexInRow)
            .sort((a, b) => a - b)
          expect(fenetresValides).toContain(indexes.join('-'))
        }
        // Aucune fenêtre de 3 sièges libres consécutifs n'existe → vide forcé.
        expect(place(seats, 3)).toEqual([])
      })
    })
  })
}
