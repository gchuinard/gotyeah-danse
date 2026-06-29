// Code de partage d'une place « GC1234 » : dérivé du qrToken + initiales, avec
// chiffre de contrôle. La garantie qui compte : une faute de frappe sur un
// chiffre est rejetée (« code invalide »), jamais résolue en silence.

import { describe, expect, it } from 'vitest'

import { codePlace, controleValide } from '@/lib/booking/code-place'

describe('codePlace', () => {
  it('format : 2 lettres d’initiales + 4 chiffres', () => {
    const c = codePlace('qr-token-abc', 'Gautier Chuinard')
    expect(c).toMatch(/^[A-Z]{2}[0-9]{4}$/)
    expect(c.slice(0, 2)).toBe('GC')
  })

  it('déterministe : mêmes entrées → même code', () => {
    expect(codePlace('tok-1', 'Marie Dupont')).toBe(codePlace('tok-1', 'Marie Dupont'))
  })

  it('dépend du billet : deux qrTokens → deux codes', () => {
    expect(codePlace('tok-1', 'Marie Dupont')).not.toBe(codePlace('tok-2', 'Marie Dupont'))
  })

  it('initiales : prénom + nom, accents retirés', () => {
    expect(codePlace('t', 'Élodie Bénézit').slice(0, 2)).toBe('EB')
  })

  it('initiales : nom unique → 2 premières lettres', () => {
    expect(codePlace('t', 'Madonna').slice(0, 2)).toBe('MA')
  })

  it('initiales : nom vide → « XX »', () => {
    expect(codePlace('t', '   ').slice(0, 2)).toBe('XX')
  })

  it('le code émis a un chiffre de contrôle valide', () => {
    expect(controleValide(codePlace('whatever', 'Jean Test'))).toBe(true)
  })
})

describe('controleValide', () => {
  it('rejette 100 % des fautes de frappe d’un seul chiffre', () => {
    const bon = codePlace('tok-xyz', 'Gautier Chuinard') // GC + 4 chiffres
    let essais = 0
    let rejets = 0
    for (let i = 2; i < 6; i++) {
      // les 4 chiffres
      for (const ch of '0123456789') {
        if (ch === bon[i]) continue
        essais++
        if (!controleValide(bon.slice(0, i) + ch + bon.slice(i + 1))) rejets++
      }
    }
    expect(essais).toBeGreaterThan(0)
    expect(rejets).toBe(essais)
  })

  it('tolère séparateurs et minuscules (normalisation)', () => {
    const bon = codePlace('tok-xyz', 'Gautier Chuinard')
    expect(controleValide(`${bon.slice(0, 2)}-${bon.slice(2)}`.toLowerCase())).toBe(true)
  })

  it('rejette les codes mal formés', () => {
    expect(controleValide('GC123')).toBe(false) // trop court
    expect(controleValide('G1C234')).toBe(false) // lettres/chiffres mêlés
    expect(controleValide('1234GC')).toBe(false) // ordre inversé
    expect(controleValide('')).toBe(false)
  })
})
