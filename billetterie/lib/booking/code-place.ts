// Code de partage d'UNE place : « initiales + 4 chiffres » (ex. « GC1234 »).
//
// Pendant côté SIÈGE de codeDemande (lib/booking/code.ts) : codeDemande ouvre
// TOUTE la réservation, codePlace désigne UN billet précis — pour le partager en
// lecture seule à une copine. DÉRIVÉ du qrToken (unique par billet) + des
// initiales du nom → stable, déterministe, NON stocké (zéro migration).
//
// Forme : 2 lettres (initiales) + 3 chiffres (dérivés du qrToken) + 1 CHIFFRE DE
// CONTRÔLE. Le contrôle rejette les fautes de frappe AVANT tout accès base
// (« code invalide » plutôt que de tomber en silence sur une autre place). Le
// vrai périmètre reste l'email : ce code n'est comparé qu'aux billets de la
// personne (cf. lookup à venir) — une faute ne peut donc jamais désigner la
// place d'un inconnu, au pire une autre place du même groupe (que le contrôle
// et le récap de confirmation rattrapent).

import { createHash } from 'node:crypto'

// Initiales ASCII (toujours 2 lettres) tirées du nom « Prénom Nom » : 1ʳᵉ lettre
// du premier mot + 1ʳᵉ du dernier. Accents retirés ; complété par « X » si le
// nom donne moins de 2 lettres (mononyme court, nom vide…).
function initiales(name: string): string {
  const mots = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // diacritiques (après NFD)
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const lettres =
    mots.length >= 2 ? mots[0][0] + mots[mots.length - 1][0] : (mots[0] ?? '').slice(0, 2)
  return (lettres + 'XX').slice(0, 2)
}

// Chiffre de contrôle 0-9 : somme pondérée mod 10, poids PREMIERS avec 10
// (7/3/9/1…) → toute substitution d'un chiffre change le résultat (donc 100 %
// des fautes d'un chiffre sont détectées ; les fautes de lettre, elles, ne
// matcheront simplement aucune place).
const POIDS = [7, 3, 9, 1, 7, 3]
function chiffreControle(corps: string): number {
  let somme = 0
  for (let i = 0; i < corps.length; i++) somme += POIDS[i % POIDS.length] * corps.charCodeAt(i)
  return somme % 10
}

// Code de partage d'un billet. Pur et déterministe (mêmes entrées → même code).
// Unicité au sein d'une réservation : quasi systématique (3 chiffres) ; le
// lookup (à venir) lèvera l'ambiguïté résiduelle si deux billets coïncidaient.
export function codePlace(qrToken: string, name: string): string {
  const ini = initiales(name)
  const hash = createHash('sha256').update(qrToken).digest()
  let chiffres = ''
  for (let i = 0; i < 3; i++) chiffres += String(hash[i] % 10)
  const corps = ini + chiffres
  return corps + chiffreControle(corps)
}

// Le chiffre de contrôle d'un code SAISI est-il cohérent ? Normalise d'abord
// (majuscules, sans séparateurs : « gc-1234 » → « GC1234 »), exige la forme
// 2 lettres + 4 chiffres, puis revérifie le dernier chiffre. Permet de rejeter
// une faute de frappe SANS toucher la base (ne dit pas que la place existe —
// juste que le code est bien formé).
export function controleValide(code: string): boolean {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z]{2}[0-9]{4}$/.test(c)) return false
  return chiffreControle(c.slice(0, 5)) === Number(c[5])
}
