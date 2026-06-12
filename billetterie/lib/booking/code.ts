// Identifiant de demande lisible (« AB3CDE ») — DÉRIVÉ du publicToken secret,
// donc stable, non stockable (zéro migration) et inimitable sans le token.
//
// Sert de second facteur d'accès « j'ai déjà une demande » : email + cet
// identifiant. 6 caractères sur un alphabet sans ambiguïté (pas de I/L/O/0/1)
// → ~30^6 ≈ 730 M combinaisons ; couplé à l'email + au rate-limit, suffisant.

import { createHash } from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 30 caractères, sans ambigus

export function codeDemande(publicToken: string): string {
  const hash = createHash('sha256').update(publicToken).digest()
  let code = ''
  for (let i = 0; i < 6; i++) code += ALPHABET[hash[i] % ALPHABET.length]
  return code
}

// Normalise une saisie utilisateur (majuscules, sans espaces/séparateurs).
// PAS de troncature : un code trop long ne doit PAS matcher (égalité stricte).
export function normaliserCode(saisie: string): string {
  return saisie.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
