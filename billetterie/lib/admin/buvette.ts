// Calculs purs du bilan buvette (saisie manuelle du soir J) — aucune dépendance
// Prisma, testable directement. Tolère une saisie incohérente (vendu > acheté)
// sans jamais produire de négatif sur les quantités.
//
// Modèle économique : on ACHÈTE une quantité (qtyStock) à un prix d'achat, on
// en VEND une partie (qtySold) à un prix de vente. La balance = recette des
// ventes − coût de tout ce qui a été acheté (le stock invendu reste un coût).

export type LigneBuvette = {
  qtyStock: number // quantité achetée / approvisionnée
  qtySold: number // quantité vendue
  unitPriceCents: number // prix unitaire de vente
  purchasePriceCents: number // prix unitaire d'achat (coût)
}

// Recette d'une ligne = vendu × prix de vente.
export function recetteLigneCents(item: LigneBuvette): number {
  return Math.max(0, item.qtySold) * Math.max(0, item.unitPriceCents)
}

// Coût d'une ligne = quantité achetée × prix d'achat (on paie tout le stock,
// vendu ou non).
export function coutLigneCents(item: LigneBuvette): number {
  return Math.max(0, item.qtyStock) * Math.max(0, item.purchasePriceCents)
}

// Balance d'une ligne = recette − coût (peut être négative : on a acheté trop,
// ou vendu moins cher que le prix d'achat).
export function balanceLigneCents(item: LigneBuvette): number {
  return recetteLigneCents(item) - coutLigneCents(item)
}

// Invendus = acheté − vendu, jamais négatif.
export function invendusLigne(item: LigneBuvette): number {
  return Math.max(0, item.qtyStock - item.qtySold)
}

export function totauxBuvette(items: LigneBuvette[]): {
  recetteCents: number
  coutCents: number
  balanceCents: number
  venduTotal: number
  achatTotal: number
} {
  return items.reduce(
    (acc, it) => ({
      recetteCents: acc.recetteCents + recetteLigneCents(it),
      coutCents: acc.coutCents + coutLigneCents(it),
      balanceCents: acc.balanceCents + balanceLigneCents(it),
      venduTotal: acc.venduTotal + Math.max(0, it.qtySold),
      achatTotal: acc.achatTotal + Math.max(0, it.qtyStock),
    }),
    { recetteCents: 0, coutCents: 0, balanceCents: 0, venduTotal: 0, achatTotal: 0 },
  )
}
