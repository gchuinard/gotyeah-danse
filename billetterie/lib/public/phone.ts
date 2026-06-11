// Numéro de téléphone français — normalisation + formatage partagés
// client (masque de saisie) et serveur (validation zod).

export const FR_PHONE_RE = /^0[1-9]\d{8}$/

// Enlève les séparateurs et ramène +33 / 0033 en 0. Renvoie les chiffres
// (ex. "0612345678"), ou ce qu'il reste si le numéro n'est pas reconnu.
export function normalizeFrPhone(raw: string): string {
  const compact = raw.replace(/[^\d+]/g, '')
  return compact.replace(/^\+33/, '0').replace(/^0033/, '0')
}

// Formate des chiffres en "06 12 34 56 78" (saisie progressive + affichage).
export function formatFrPhone(value: string): string {
  return normalizeFrPhone(value)
    .replace(/\D/g, '')
    .slice(0, 10)
    .replace(/(\d{2})(?=\d)/g, '$1 ')
    .trim()
}
