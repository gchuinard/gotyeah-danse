// Numéro de téléphone FR — masque de saisie (formatFrPhone), normalisation
// (+33 / 0033 → 0, séparateurs ignorés) et validation (FR_PHONE_RE). Le contrat
// qui compte : un numéro saisi « à la française » est accepté, un numéro de
// mauvaise longueur ou de mauvais préfixe est rejeté — jamais corrigé en silence.

import { describe, expect, it } from 'vitest'

import { FR_PHONE_RE, formatFrPhone, normalizeFrPhone } from '@/lib/public/phone'

// Reproduit la validation zod réelle (booking-schema.ts / billets actions) :
// on normalise PUIS on teste la regex — c'est le pipeline de bout en bout.
const estValide = (raw: string) => FR_PHONE_RE.test(normalizeFrPhone(raw))

describe('normalizeFrPhone', () => {
  it('retire les séparateurs (espaces, points, tirets)', () => {
    expect(normalizeFrPhone('06 12 34 56 78')).toBe('0612345678')
    expect(normalizeFrPhone('06.12.34.56.78')).toBe('0612345678')
    expect(normalizeFrPhone('06-12-34-56-78')).toBe('0612345678')
  })

  it('ramène l’indicatif international +33 à 0', () => {
    expect(normalizeFrPhone('+33 6 12 34 56 78')).toBe('0612345678')
  })

  it('ramène l’indicatif international 0033 à 0', () => {
    expect(normalizeFrPhone('0033 6 12 34 56 78')).toBe('0612345678')
  })

  it('ignore les espaces de tête et de fin', () => {
    expect(normalizeFrPhone('  06 12 34 56 78  ')).toBe('0612345678')
  })

  it('retire lettres et symboles parasites', () => {
    expect(normalizeFrPhone('06abc12')).toBe('0612')
  })

  it('chaîne vide → chaîne vide', () => {
    expect(normalizeFrPhone('')).toBe('')
  })

  it('non reconnu → renvoie ce qu’il reste (les chiffres seuls)', () => {
    expect(normalizeFrPhone('texte sans chiffre')).toBe('')
    expect(normalizeFrPhone('12 34')).toBe('1234')
  })

  it('le « (0) » redondant après +33 n’est PAS absorbé (cas limite)', () => {
    // +33 (0)6… : on retire les parenthèses mais le 0 demeure → 11 chiffres.
    expect(normalizeFrPhone('+33 (0)6 12 34 56 78')).toBe('00612345678')
  })
})

describe('formatFrPhone', () => {
  it('regroupe les chiffres par paires : 06 12 34 56 78', () => {
    expect(formatFrPhone('0612345678')).toBe('06 12 34 56 78')
  })

  it('fonctionne aussi pour un 07 et un numéro fixe', () => {
    expect(formatFrPhone('0712345678')).toBe('07 12 34 56 78')
    expect(formatFrPhone('0123456789')).toBe('01 23 45 67 89')
  })

  it('saisie progressive : l’espace n’apparaît qu’après une paire complète', () => {
    expect(formatFrPhone('0')).toBe('0')
    expect(formatFrPhone('06')).toBe('06')
    expect(formatFrPhone('061')).toBe('06 1')
    expect(formatFrPhone('0612')).toBe('06 12')
    expect(formatFrPhone('06123')).toBe('06 12 3')
  })

  it('ignore les caractères non numériques saisis', () => {
    expect(formatFrPhone('06ab12cd34')).toBe('06 12 34')
  })

  it('tronque au-delà de 10 chiffres', () => {
    expect(formatFrPhone('0612345678999')).toBe('06 12 34 56 78')
  })

  it('normalise +33 / 0033 avant de formater', () => {
    expect(formatFrPhone('+33612345678')).toBe('06 12 34 56 78')
    expect(formatFrPhone('0033612345678')).toBe('06 12 34 56 78')
  })

  it('idempotent : reformater un numéro déjà formaté ne change rien', () => {
    expect(formatFrPhone('06 12 34 56 78')).toBe('06 12 34 56 78')
    expect(formatFrPhone(formatFrPhone('0612345678'))).toBe('06 12 34 56 78')
  })

  it('chaîne vide / uniquement des blancs → chaîne vide', () => {
    expect(formatFrPhone('')).toBe('')
    expect(formatFrPhone('   ')).toBe('')
  })
})

describe('FR_PHONE_RE', () => {
  it('accepte les 10 chiffres FR valides (06 / 07 / 01 / 09)', () => {
    expect(FR_PHONE_RE.test('0612345678')).toBe(true)
    expect(FR_PHONE_RE.test('0712345678')).toBe(true)
    expect(FR_PHONE_RE.test('0123456789')).toBe(true)
    expect(FR_PHONE_RE.test('0987654321')).toBe(true)
  })

  it('rejette un 2e chiffre à 0 (préfixe 00…)', () => {
    expect(FR_PHONE_RE.test('0012345678')).toBe(false)
  })

  it('rejette une longueur incorrecte', () => {
    expect(FR_PHONE_RE.test('061234567')).toBe(false) // 9 chiffres
    expect(FR_PHONE_RE.test('06123456789')).toBe(false) // 11 chiffres
  })

  it('rejette ce qui n’est pas des chiffres bruts (espaces, +)', () => {
    expect(FR_PHONE_RE.test('06 12 34 56 78')).toBe(false)
    expect(FR_PHONE_RE.test('+33612345678')).toBe(false)
  })
})

describe('pipeline normalisation + validation (usage zod réel)', () => {
  it('accepte les saisies « à la française »', () => {
    expect(estValide('06 12 34 56 78')).toBe(true)
    expect(estValide('06.12.34.56.78')).toBe(true)
    expect(estValide('+33 6 12 34 56 78')).toBe(true)
    expect(estValide('0033612345678')).toBe(true)
    expect(estValide('01 23 45 67 89')).toBe(true)
  })

  it('rejette les numéros invalides', () => {
    expect(estValide('00 12 34 56 78')).toBe(false) // préfixe 00
    expect(estValide('06 12 34 56')).toBe(false) // trop court
    expect(estValide('06 12 34 56 78 90')).toBe(false) // trop long
    expect(estValide('+33 (0)6 12 34 56 78')).toBe(false) // (0) redondant
    expect(estValide('pas un numéro')).toBe(false)
    expect(estValide('')).toBe(false)
  })
})
