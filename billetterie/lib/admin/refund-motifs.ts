// Motifs de remboursement courants proposés dans la popup de paiement.
// Partagé client (menu déroulant) / serveur (résolution du motif).
// MOTIF_AUTRE est la valeur sentinelle qui bascule sur un champ libre.

export const MOTIF_AUTRE = '__autre__'

export const REFUND_MOTIFS = [
  'Place(s) retirée(s)',
  'Demande annulée',
  'Erreur de montant',
  'Geste commercial',
] as const
