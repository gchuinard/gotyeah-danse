import { describe, expect, it } from 'vitest'

import { invendusLigne, recetteLigneCents, totauxBuvette } from '@/lib/admin/buvette'

describe('buvette — calculs du bilan', () => {
  it('recette ligne = vendu × prix unitaire', () => {
    expect(recetteLigneCents({ qtyStock: 30, qtySold: 24, unitPriceCents: 250 })).toBe(6000)
  })

  it('invendus = proposé − vendu, jamais négatif', () => {
    expect(invendusLigne({ qtyStock: 30, qtySold: 24, unitPriceCents: 250 })).toBe(6)
    // Saisie incohérente (vendu > proposé) → 0, pas un négatif.
    expect(invendusLigne({ qtyStock: 10, qtySold: 12, unitPriceCents: 100 })).toBe(0)
  })

  it('totaux : agrège recette, vendus et invendus', () => {
    const t = totauxBuvette([
      { qtyStock: 30, qtySold: 24, unitPriceCents: 250 }, // 6000, 24 vendus, 6 invendus
      { qtyStock: 20, qtySold: 5, unitPriceCents: 300 }, // 1500, 5 vendus, 15 invendus
    ])
    expect(t.recetteCents).toBe(7500)
    expect(t.venduTotal).toBe(29)
    expect(t.invendusTotal).toBe(21)
  })

  it('liste vide → tout à zéro', () => {
    expect(totauxBuvette([])).toEqual({ recetteCents: 0, venduTotal: 0, invendusTotal: 0 })
  })
})
