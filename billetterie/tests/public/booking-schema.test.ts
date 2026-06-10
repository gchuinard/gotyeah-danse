// Tests du schéma zod du formulaire public de demande de places.
//
// Le schéma reçoit des valeurs issues de FormData : tout arrive en string,
// d'où les tests de coercition (partySize notamment).

import { describe, expect, it } from 'vitest'

import { bookingSchema } from '@/lib/public/booking-schema'

// Demande valide de référence — chaque test invalide n'écrase qu'un champ.
const demandeValide = {
  representationId: 'rep-samedi-soir',
  name: 'Famille Dupont',
  email: 'famille.dupont@example.com',
  phone: '06 12 34 56 78',
  partySize: '4',
  notes: 'Une place PMR si possible',
  website: '',
}

describe('bookingSchema — cas valide', () => {
  it('accepte une demande complète et coerce partySize en nombre', () => {
    const result = bookingSchema.safeParse(demandeValide)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.partySize).toBe(4)
    expect(result.data.name).toBe('Famille Dupont')
    expect(result.data.notes).toBe('Une place PMR si possible')
  })

  it('accepte une demande sans notes (champ optionnel)', () => {
    const { notes: _notes, ...sansNotes } = demandeValide
    const result = bookingSchema.safeParse(sansNotes)
    expect(result.success).toBe(true)
  })

  it('transforme une note vide en undefined', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, notes: '   ' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.notes).toBeUndefined()
  })

  it('trim le nom et le téléphone', () => {
    const result = bookingSchema.safeParse({
      ...demandeValide,
      name: '  Famille Dupont  ',
      phone: ' 0612345678 ',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.name).toBe('Famille Dupont')
    expect(result.data.phone).toBe('0612345678')
  })
})

describe('bookingSchema — representationId', () => {
  it('refuse une chaîne vide', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, representationId: '' })
    expect(result.success).toBe(false)
  })

  it('refuse une valeur absente', () => {
    const { representationId: _id, ...sansRep } = demandeValide
    const result = bookingSchema.safeParse(sansRep)
    expect(result.success).toBe(false)
  })
})

describe('bookingSchema — name', () => {
  it('refuse un nom trop court (1 caractère)', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, name: 'A' })
    expect(result.success).toBe(false)
  })

  it("refuse un nom composé uniquement d'espaces (trim avant min)", () => {
    const result = bookingSchema.safeParse({ ...demandeValide, name: '    ' })
    expect(result.success).toBe(false)
  })

  it('refuse un nom de plus de 100 caractères', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })
})

describe('bookingSchema — email', () => {
  it('refuse une adresse invalide', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, email: 'pas-un-email' })
    expect(result.success).toBe(false)
  })

  it('refuse une adresse de plus de 200 caractères', () => {
    const email = `${'a'.repeat(195)}@ex.com`
    const result = bookingSchema.safeParse({ ...demandeValide, email })
    expect(result.success).toBe(false)
  })
})

describe('bookingSchema — phone', () => {
  it('refuse un numéro trop court (moins de 6 caractères)', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, phone: '06123' })
    expect(result.success).toBe(false)
  })

  it('refuse un numéro trop long (plus de 20 caractères)', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, phone: '0'.repeat(21) })
    expect(result.success).toBe(false)
  })

  it('refuse des caractères interdits (lettres)', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, phone: '06 12 34 AB' })
    expect(result.success).toBe(false)
  })

  it('accepte le format international avec + . -', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, phone: '+33.6-12 34 56 78' })
    expect(result.success).toBe(true)
  })
})

describe('bookingSchema — partySize', () => {
  it('refuse 0 place', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, partySize: '0' })
    expect(result.success).toBe(false)
  })

  it('refuse 9 places (maximum 8)', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, partySize: '9' })
    expect(result.success).toBe(false)
  })

  it('refuse une valeur non numérique', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, partySize: 'beaucoup' })
    expect(result.success).toBe(false)
  })

  it('refuse une valeur non entière', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, partySize: '2.5' })
    expect(result.success).toBe(false)
  })

  it('coerce les bornes valides depuis des strings (1 et 8)', () => {
    for (const [brut, attendu] of [
      ['1', 1],
      ['8', 8],
    ] as const) {
      const result = bookingSchema.safeParse({ ...demandeValide, partySize: brut })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.partySize).toBe(attendu)
    }
  })
})

describe('bookingSchema — notes', () => {
  it('refuse un commentaire de plus de 500 caractères', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, notes: 'x'.repeat(501) })
    expect(result.success).toBe(false)
  })
})

describe('bookingSchema — honeypot website', () => {
  it('refuse un honeypot rempli (le schéma sert de filet de sécurité)', () => {
    const result = bookingSchema.safeParse({ ...demandeValide, website: 'https://spam.example' })
    expect(result.success).toBe(false)
  })

  it('accepte un honeypot vide ou absent', () => {
    expect(bookingSchema.safeParse(demandeValide).success).toBe(true)
    const { website: _w, ...sansWebsite } = demandeValide
    expect(bookingSchema.safeParse(sansWebsite).success).toBe(true)
  })
})
