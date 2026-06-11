// Validation des fichiers de salle JSON (multi-salles + créateur de salle).

import { describe, expect, it } from 'vitest'

import { venueConfig } from '@/config/venue'
import { parseVenueConfig } from '@/lib/venue/schema'

describe('parseVenueConfig', () => {
  it('accepte la salle intégrée (Bergerac) sérialisée en JSON', () => {
    const json = JSON.parse(JSON.stringify(venueConfig))
    const parsed = parseVenueConfig(json, 'test')
    expect(parsed.rows).toHaveLength(25)
    expect(parsed.name).toBe('Centre Culturel de Bergerac')
  })

  it('refuse un label de rang dupliqué', () => {
    const json = JSON.parse(JSON.stringify(venueConfig))
    json.rows[1].label = json.rows[0].label
    expect(() => parseVenueConfig(json, 'test')).toThrow(/uniques/)
  })

  it('refuse une section inconnue', () => {
    const json = JSON.parse(JSON.stringify(venueConfig))
    json.rows[0].arcs[0].section = 'balcon'
    expect(() => parseVenueConfig(json, 'test')).toThrow(/invalide/i)
  })

  it('refuse un nombre de sièges nul', () => {
    const json = JSON.parse(JSON.stringify(venueConfig))
    json.rows[0].arcs[0].seats = 0
    expect(() => parseVenueConfig(json, 'test')).toThrow(/invalide/i)
  })

  it("message d'erreur : cite la source et le chemin du problème", () => {
    const json = JSON.parse(JSON.stringify(venueConfig))
    json.center = { x: 'oops', y: 0 }
    expect(() => parseVenueConfig(json, 'ma-salle.json')).toThrow(/ma-salle\.json/)
  })
})
