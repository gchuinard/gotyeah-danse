import { describe, expect, it } from 'vitest'

import {
  balanceLigneCents,
  coutLigneCents,
  invendusLigne,
  recetteLigneCents,
  totauxBuvette,
} from '@/lib/admin/buvette'

describe('buvette — calculs du bilan', () => {
  it('recette ligne = vendu × prix de vente', () => {
    expect(
      recetteLigneCents({ qtyStock: 30, qtySold: 24, unitPriceCents: 250, purchasePriceCents: 100 }),
    ).toBe(6000)
  })

  it('coût ligne = acheté × prix d’achat (tout le stock, vendu ou non)', () => {
    expect(
      coutLigneCents({ qtyStock: 30, qtySold: 24, unitPriceCents: 250, purchasePriceCents: 100 }),
    ).toBe(3000)
  })

  it('balance ligne = recette − coût (peut être négative)', () => {
    // 24 × 2,50 € = 60 € de recette ; 30 × 1 € = 30 € de coût → +30 €
    expect(
      balanceLigneCents({ qtyStock: 30, qtySold: 24, unitPriceCents: 250, purchasePriceCents: 100 }),
    ).toBe(3000)
    // Acheté cher (50 × 1,50 €) et peu vendu (5 × 1 €) → balance négative
    expect(
      balanceLigneCents({ qtyStock: 50, qtySold: 5, unitPriceCents: 100, purchasePriceCents: 150 }),
    ).toBe(500 - 7500)
  })

  it('invendus = acheté − vendu, jamais négatif', () => {
    expect(
      invendusLigne({ qtyStock: 30, qtySold: 24, unitPriceCents: 250, purchasePriceCents: 100 }),
    ).toBe(6)
    // Saisie incohérente (vendu > acheté) → 0, pas un négatif.
    expect(
      invendusLigne({ qtyStock: 10, qtySold: 12, unitPriceCents: 100, purchasePriceCents: 50 }),
    ).toBe(0)
  })

  it('totaux : agrège recette, coût, balance, vendus et achats', () => {
    const t = totauxBuvette([
      { qtyStock: 30, qtySold: 24, unitPriceCents: 250, purchasePriceCents: 100 }, // recette 6000, coût 3000
      { qtyStock: 20, qtySold: 5, unitPriceCents: 300, purchasePriceCents: 100 }, // recette 1500, coût 2000
    ])
    expect(t.recetteCents).toBe(7500)
    expect(t.coutCents).toBe(5000)
    expect(t.balanceCents).toBe(2500)
    expect(t.venduTotal).toBe(29)
    expect(t.achatTotal).toBe(50)
  })

  it('liste vide → tout à zéro', () => {
    expect(totauxBuvette([])).toEqual({
      recetteCents: 0,
      coutCents: 0,
      balanceCents: 0,
      venduTotal: 0,
      achatTotal: 0,
    })
  })
})
