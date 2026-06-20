import { describe, expect, it } from 'vitest'

import {
  areReadingsEmpty,
  emptyReadings,
  formatReading,
  normalizeSky,
  normalizeTemp,
  parseWeatherReadings,
  serializeWeatherReadings,
} from '@/lib/admin/weather'

describe('weather — relevés début / milieu / fin', () => {
  it('normalizeSky : liste blanche, sinon ""', () => {
    expect(normalizeSky('soleil')).toBe('soleil')
    expect(normalizeSky('inconnu')).toBe('')
    expect(normalizeSky('')).toBe('')
    expect(normalizeSky(null)).toBe('')
    expect(normalizeSky(42)).toBe('')
  })

  it('normalizeTemp : nombre fini arrondi et borné, sinon null', () => {
    expect(normalizeTemp('27')).toBe(27)
    expect(normalizeTemp('21,6')).toBe(22) // virgule décimale + arrondi
    expect(normalizeTemp(18.4)).toBe(18)
    expect(normalizeTemp('')).toBeNull()
    expect(normalizeTemp('abc')).toBeNull()
    expect(normalizeTemp(999)).toBeNull() // hors bornes
    expect(normalizeTemp(-100)).toBeNull()
  })

  it('parse : JSON nul / vide / corrompu → relevés vides', () => {
    expect(parseWeatherReadings(null)).toEqual(emptyReadings())
    expect(parseWeatherReadings('')).toEqual(emptyReadings())
    expect(parseWeatherReadings('pas du json')).toEqual(emptyReadings())
    expect(areReadingsEmpty(parseWeatherReadings(null))).toBe(true)
  })

  it('parse : JSON valide normalisé (3 moments toujours présents)', () => {
    const w = parseWeatherReadings(
      JSON.stringify({
        debut: { sky: 'soleil', tempC: 27 },
        milieu: { sky: 'BIDON', tempC: '25' },
        // fin absent → vide
      }),
    )
    expect(w.debut).toEqual({ sky: 'soleil', tempC: 27 })
    expect(w.milieu).toEqual({ sky: '', tempC: 25 }) // ciel inconnu ignoré, temp string OK
    expect(w.fin).toEqual({ sky: '', tempC: null })
  })

  it('serialize : null si tout est vide, JSON sinon (round-trip)', () => {
    expect(serializeWeatherReadings(emptyReadings())).toBeNull()
    const w = emptyReadings()
    w.fin = { sky: 'pluie', tempC: 18 }
    const json = serializeWeatherReadings(w)
    expect(json).not.toBeNull()
    expect(parseWeatherReadings(json)).toEqual(w)
  })

  it('formatReading : résumé lisible', () => {
    expect(formatReading({ sky: 'soleil', tempC: 24 })).toBe('☀️ Soleil · 24 °C')
    expect(formatReading({ sky: 'pluie', tempC: null })).toBe('🌧️ Pluie')
    expect(formatReading({ sky: '', tempC: 18 })).toBe('18 °C')
    expect(formatReading({ sky: '', tempC: null })).toBe('—')
  })
})
