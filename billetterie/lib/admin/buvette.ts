// Calculs purs du bilan buvette (saisie manuelle du soir J) — aucune dépendance
// Prisma, testable directement. Tolère une saisie incohérente (vendu > proposé)
// sans jamais produire de négatif.

export type LigneBuvette = {
  qtyStock: number // proposé / approvisionné
  qtySold: number // vendu
  unitPriceCents: number // prix unitaire de vente
}

// Recette d'une ligne = vendu × prix unitaire.
export function recetteLigneCents(item: LigneBuvette): number {
  return Math.max(0, item.qtySold) * Math.max(0, item.unitPriceCents)
}

// Invendus = proposé − vendu, jamais négatif.
export function invendusLigne(item: LigneBuvette): number {
  return Math.max(0, item.qtyStock - item.qtySold)
}

export function totauxBuvette(items: LigneBuvette[]): {
  recetteCents: number
  venduTotal: number
  invendusTotal: number
} {
  return items.reduce(
    (acc, it) => ({
      recetteCents: acc.recetteCents + recetteLigneCents(it),
      venduTotal: acc.venduTotal + Math.max(0, it.qtySold),
      invendusTotal: acc.invendusTotal + invendusLigne(it),
    }),
    { recetteCents: 0, venduTotal: 0, invendusTotal: 0 },
  )
}
