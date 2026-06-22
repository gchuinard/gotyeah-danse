// Calculs d'argent d'une demande — PURS (aucun Prisma, aucune horloge), donc
// partagés sans risque de divergence entre la liste des demandes, la popup
// centre d'actions, la caisse (/admin/stats), l'export CSV et la page de suivi
// côté famille. Tout est en centimes, en nombres entiers.
//
// Modèle : une demande a `partySize` places dont `freeSeats` offertes ; au prix
// unitaire global `unitPriceCents`, le montant DÛ = (partySize − freeSeats) × prix.
// Elle reçoit un ou plusieurs versements (espèces / chèques) ; le total REÇU en
// est la somme. La caisse compte le NET = reçu − remboursé. La demande est
// SOLDÉE quand le net atteint le dû (les chèques comptent dès leur remise, peu
// importe leur date de dépôt — cf. lib/admin/pricing.ts).

export type PaymentLite = { method: string; amountCents: number }

// Montant dû en centimes, ou null si le prix unitaire n'est pas défini.
export function montantDuCents(
  partySize: number,
  freeSeats: number,
  unitPriceCents: number | null,
): number | null {
  if (unitPriceCents == null) return null
  const offertes = Math.min(Math.max(0, Math.trunc(freeSeats)), partySize)
  const payantes = Math.max(0, partySize - offertes)
  return payantes * unitPriceCents
}

export function totalRemisCents(payments: readonly PaymentLite[]): number {
  return payments.reduce((s, p) => s + (Number.isFinite(p.amountCents) ? p.amountCents : 0), 0)
}

export type ResumePaiement = {
  duCents: number | null // montant dû (null = prix non défini)
  remisCents: number // Σ versements (brut, avant remboursement)
  rembourseCents: number // total remboursé
  netCents: number // remis − remboursé = ce qui reste réellement en caisse
  resteCents: number | null // max(0, dû − net) ; null si dû inconnu
  tropPercuCents: number // max(0, net − dû) ; 0 si dû inconnu
  soldee: boolean | null // net ≥ dû ; null si dû inconnu
}

export function resumePaiement(args: {
  partySize: number
  freeSeats: number
  unitPriceCents: number | null
  payments: readonly PaymentLite[]
  refundCents: number | null
}): ResumePaiement {
  const duCents = montantDuCents(args.partySize, args.freeSeats, args.unitPriceCents)
  const remisCents = totalRemisCents(args.payments)
  const rembourseCents = Math.max(0, args.refundCents ?? 0)
  const netCents = remisCents - rembourseCents
  const resteCents = duCents == null ? null : Math.max(0, duCents - netCents)
  const tropPercuCents = duCents == null ? 0 : Math.max(0, netCents - duCents)
  const soldee = duCents == null ? null : netCents >= duCents
  return { duCents, remisCents, rembourseCents, netCents, resteCents, tropPercuCents, soldee }
}

// État d'affichage du paiement (chip admin / texte famille). `aPaidAt` = la
// demande a été marquée payée à un moment (paidAt non null) : sert UNIQUEMENT à
// distinguer une demande historique « réglée sans montant saisi » (0 versement
// mais paidAt posé) d'une demande réellement non réglée.
export type EtatPaiement =
  | 'non_paye' // aucun versement, jamais marquée payée
  | 'sans_montant' // marquée payée mais aucun montant enregistré (héritage)
  | 'acompte' // versements partiels (net < dû)
  | 'paye' // au moins un versement, prix non défini → montant connu mais pas le dû
  | 'solde' // net ≥ dû
  | 'trop_percu' // net > dû (à régulariser)

export function etatPaiement(resume: ResumePaiement, aPaidAt: boolean): EtatPaiement {
  if (resume.remisCents === 0) return aPaidAt ? 'sans_montant' : 'non_paye'
  if (resume.duCents == null) return 'paye'
  if (resume.tropPercuCents > 0) return 'trop_percu'
  if (resume.soldee) return 'solde'
  return 'acompte'
}

// Formatage € FR à partir de centimes : « 64,00 € ».
export function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`
}
