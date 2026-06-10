// Schéma de validation du formulaire public de demande de places.
//
// Le honeypot `website` est déclaré ici par cohérence (il doit rester vide),
// mais l'action serveur le traite AVANT la validation zod : si un robot le
// remplit, elle renvoie un succès factice sans rien créer ni rien révéler.

import { z } from 'zod'

export const bookingSchema = z.object({
  representationId: z
    .string('Choisissez une représentation.')
    .min(1, 'Choisissez une représentation.'),

  name: z
    .string('Indiquez votre nom.')
    .trim()
    .min(2, 'Le nom doit contenir au moins 2 caractères.')
    .max(100, 'Le nom ne peut pas dépasser 100 caractères.'),

  email: z
    .email('Adresse email invalide.')
    .max(200, "L'adresse email ne peut pas dépasser 200 caractères."),

  phone: z
    .string('Indiquez votre numéro de téléphone.')
    .trim()
    .regex(
      /^[0-9 +.\-]{6,20}$/,
      'Numéro de téléphone invalide (6 à 20 caractères : chiffres, espaces, +, . ou -).',
    ),

  // Coercition depuis FormData (les valeurs arrivent en string).
  partySize: z.coerce
    .number('Indiquez un nombre de places valide.')
    .int('Le nombre de places doit être un nombre entier.')
    .min(1, 'Demandez au moins 1 place.')
    .max(8, 'Maximum 8 places par demande. Au-delà, contactez-nous aux permanences.'),

  // Commentaire libre (PMR, demandes particulières). Chaîne vide → undefined.
  notes: z
    .string()
    .trim()
    .max(500, 'Le commentaire ne peut pas dépasser 500 caractères.')
    .optional()
    .transform((v) => (v ? v : undefined)),

  // Honeypot anti-robots : doit rester vide.
  website: z.string().max(0, 'Champ invalide.').optional(),
})

export type BookingInput = z.infer<typeof bookingSchema>
