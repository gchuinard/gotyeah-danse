// Schéma de validation du formulaire public de demande de places.
//
// Le honeypot `website` est déclaré ici par cohérence (il doit rester vide),
// mais l'action serveur le traite AVANT la validation zod : si un robot le
// remplit, elle renvoie un succès factice sans rien créer ni rien révéler.

import { z } from 'zod'

import { MAX_PARTY_SIZE } from './limits'
import { FR_PHONE_RE, normalizeFrPhone } from './phone'

export const bookingSchema = z.object({
  representationId: z
    .string('Choisissez une représentation.')
    .min(1, 'Choisissez une représentation.'),

  firstName: z
    .string('Indiquez votre prénom.')
    .trim()
    .min(1, 'Indiquez votre prénom.')
    .max(60, 'Le prénom ne peut pas dépasser 60 caractères.'),

  lastName: z
    .string('Indiquez votre nom.')
    .trim()
    .min(1, 'Indiquez votre nom.')
    .max(60, 'Le nom ne peut pas dépasser 60 caractères.'),

  email: z
    .email('Adresse email invalide.')
    .max(200, "L'adresse email ne peut pas dépasser 200 caractères.")
    // Normalisée en minuscules : sert de clé d'identification d'une demande.
    .transform((v) => v.trim().toLowerCase()),

  // Téléphone FR : normalisé (séparateurs, +33) puis validé 10 chiffres,
  // STOCKÉ EN CHIFFRES ("0612345678") — l'affichage est formaté à la volée
  // (formatFrPhone) côté admin/famille. Stockage uniforme → recherche fiable.
  phone: z
    .string('Indiquez votre numéro de téléphone.')
    .trim()
    .transform(normalizeFrPhone)
    .refine((d) => FR_PHONE_RE.test(d), 'Numéro invalide. Format attendu : 06 12 34 56 78.'),

  // Coercition depuis FormData (les valeurs arrivent en string).
  partySize: z.coerce
    .number('Indiquez un nombre de places valide.')
    .int('Le nombre de places doit être un nombre entier.')
    .min(1, 'Demandez au moins 1 place.')
    .max(
      MAX_PARTY_SIZE,
      `Maximum ${MAX_PARTY_SIZE} places par demande. Au-delà, contactez-nous aux permanences.`,
    ),

  // Répartition tarifaire : nombre d'enfants parmi partySize (champ absent → 0).
  // Borné à partySize côté création (creer.ts). Le reste = adultes.
  childCount: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_PARTY_SIZE)
    .optional()
    .transform((v) => v ?? 0),

  // Commentaire libre (demandes particulières). Chaîne vide → undefined.
  notes: z
    .string()
    .trim()
    .max(500, 'Le commentaire ne peut pas dépasser 500 caractères.')
    .optional()
    .transform((v) => (v ? v : undefined)),

  // Accessibilité PMR : nombre de personnes à mobilité réduite dans le groupe
  // (champ absent → 0 = demande non PMR). Borné à partySize côté création.
  pmrCount: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_PARTY_SIZE)
    .optional()
    .transform((v) => v ?? 0),

  // Places accompagnant à coller aux emplacements PMR (0 = aucune). Borné, remis
  // à 0 si la demande n'est pas PMR (cf. action).
  pmrCompanions: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_PARTY_SIZE)
    .optional()
    .transform((v) => v ?? 0),

  // Honeypot anti-robots : doit rester vide.
  website: z.string().max(0, 'Champ invalide.').optional(),
})

export type BookingInput = z.infer<typeof bookingSchema>
