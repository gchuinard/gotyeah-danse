// Code de demande « AB3CDE » : dérivé du publicToken secret (donc stable et
// inimitable), sur un alphabet sans caractères ambigus (pas de I/L/O/0/1). Et
// la normalisation de la saisie : majuscules + séparateurs retirés, SANS
// troncature (un code trop long ne doit jamais matcher par égalité stricte).

import { describe, expect, it } from 'vitest'

import { codeDemande, normaliserCode } from '@/lib/booking/code'

// Alphabet de sortie attendu (23 lettres sans I/L/O + chiffres 2..9).
const ALPHABET_OK = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/

describe('codeDemande', () => {
  it('format : 6 caractères sur l’alphabet sans ambiguïté', () => {
    expect(codeDemande('public-token-123')).toMatch(ALPHABET_OK)
  })

  it('n’émet jamais de caractère ambigu (I, L, O, 0, 1)', () => {
    // On balaie de nombreux tokens : aucun code ne doit contenir d’ambigu.
    for (let i = 0; i < 250; i++) {
      expect(codeDemande(`jeton-${i}`)).not.toMatch(/[ILO01]/)
    }
  })

  it('déterministe : même token → même code', () => {
    expect(codeDemande('tok-1')).toBe(codeDemande('tok-1'))
    expect(codeDemande('public-token-123')).toBe(codeDemande('public-token-123'))
  })

  it('caractérisation : valeurs de référence verrouillées (sha256)', () => {
    // Golden values : si l’algorithme dérive, ces égalités sautent.
    expect(codeDemande('tok-1')).toBe('JD3UJG')
    expect(codeDemande('tok-2')).toBe('984GS7')
    expect(codeDemande('public-token-123')).toBe('T2EJU6')
    expect(codeDemande('deadbeef')).toBe('PXACTA')
  })

  it('dépend du token : deux tokens → deux codes différents', () => {
    expect(codeDemande('tok-1')).not.toBe(codeDemande('tok-2'))
  })

  it('sensible au token : une variation minime change le code', () => {
    // La casse du token compte (sha256 est sensible aux octets).
    expect(codeDemande('AAAA')).not.toBe(codeDemande('aaaa'))
  })

  it('limite : token vide → code valide de 6 caractères', () => {
    expect(codeDemande('')).toBe('MYME7E')
    expect(codeDemande('')).toMatch(ALPHABET_OK)
  })

  it('un code peut commencer par un chiffre (pas réservé aux lettres)', () => {
    expect(codeDemande('tok-2')).toBe('984GS7')
    expect(codeDemande('tok-2')[0]).toMatch(/[0-9]/)
  })

  it('robustesse : 300 tokens → tous des codes 6 car. dans l’alphabet', () => {
    for (let i = 0; i < 300; i++) {
      expect(codeDemande(`token-aléatoire-${i}-🎟`)).toMatch(ALPHABET_OK)
    }
  })
})

describe('normaliserCode', () => {
  it('passe la saisie en majuscules', () => {
    expect(normaliserCode('ab3cde')).toBe('AB3CDE')
  })

  it('retire les espaces', () => {
    expect(normaliserCode('  AB 3C DE  ')).toBe('AB3CDE')
  })

  it('retire tirets, points et autres séparateurs', () => {
    expect(normaliserCode('ab-3c.de')).toBe('AB3CDE')
    expect(normaliserCode('A/B*3#C')).toBe('AB3C')
  })

  it('PAS de troncature : un code trop long reste long', () => {
    // Garantie clé : l’égalité stricte rejette un code de plus de 6 car.
    const trop = normaliserCode('ab3cde-xyz')
    expect(trop).toBe('AB3CDEXYZ')
    expect(trop).not.toBe('AB3CDE')
  })

  it('chaîne vide → chaîne vide', () => {
    expect(normaliserCode('')).toBe('')
  })

  it('que des séparateurs → chaîne vide', () => {
    expect(normaliserCode('  --..// ')).toBe('')
  })

  it('retire les accents (lettre accentuée non [A-Z])', () => {
    // 'café' → 'CAFÉ' → le É (hors A-Z) tombe → 'CAF'.
    expect(normaliserCode('café')).toBe('CAF')
    expect(normaliserCode('Élodie')).toBe('LODIE')
  })

  it('garde 0 et 1 : alphabet générique, pas l’alphabet du code émis', () => {
    // normaliserCode ne connaît pas la restriction I/L/O/0/1 — il garde 0..9.
    expect(normaliserCode('ab0cd1')).toBe('AB0CD1')
  })

  it('idempotente : normaliser deux fois = normaliser une fois', () => {
    const s = 'gc-12 34.x'
    expect(normaliserCode(normaliserCode(s))).toBe(normaliserCode(s))
  })

  it('retire emoji et caractères unicode', () => {
    expect(normaliserCode('ab🎟3cd')).toBe('AB3CD')
  })
})

describe('codeDemande + normaliserCode (intégration)', () => {
  it('le code émis est déjà canonique : normaliser = identité', () => {
    for (const t of ['', 'tok-1', 'public-token-123', 'deadbeef']) {
      const code = codeDemande(t)
      expect(normaliserCode(code)).toBe(code)
    }
  })

  it('une saisie « sale » (minuscules + séparateurs) re-normalise vers le code exact', () => {
    const code = codeDemande('public-token-123') // 'T2EJU6'
    const saisie = ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} `
    expect(normaliserCode(saisie)).toBe(code)
  })
})
