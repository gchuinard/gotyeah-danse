// Motifs de remboursement courants proposés dans la popup de paiement.
// Partagé client (menu déroulant) / serveur (résolution du motif).
// MOTIF_AUTRE est la valeur sentinelle qui bascule sur un champ libre.

export const MOTIF_AUTRE = '__autre__'

// Motif « place(s) retirée(s) » : on lui associe un NOMBRE de places (champ
// dédié dans la popup). Le motif enregistré devient « Place(s) retirée(s) : N »
// (préfixe stable → ré-ouverture qui retrouve le motif + le nombre).
export const MOTIF_PLACES_RETIREES = 'Place(s) retirée(s)'
export const MOTIF_PLACES_RETIREES_SEP = ' : '

export const REFUND_MOTIFS = [
  MOTIF_PLACES_RETIREES,
  'Demande annulée',
  'Erreur de montant',
  'Geste commercial',
] as const
