// Schéma zod de VenueConfig — valide les fichiers de salle JSON
// (config/venues/<id>.json, multi-salles) et les sorties du créateur de salle.
// Aucune dépendance Node : utilisable côté client (aperçu du builder).

import { z } from 'zod'

import type { VenueConfig } from '@/config/venue'

const arcSchema = z
  .object({
    section: z.enum(['gauche', 'centre', 'droite']),
    angleStart: z.number().gt(-90).lt(90),
    angleEnd: z.number().gt(-90).lt(90),
    seats: z.number().int().min(1).max(200),
    removable: z.boolean().optional(),
    firstNumber: z.number().int().min(1).max(999).optional(),
    contiguousWithPrevious: z.boolean().optional(),
  })
  .refine((a) => a.seats === 1 || a.angleStart < a.angleEnd, {
    message: 'angleStart doit être inférieur à angleEnd',
  })

const rowSchema = z.object({
  label: z.string().trim().min(1).max(3),
  radius: z.number().positive(),
  arcs: z.array(arcSchema).min(1).max(8),
})

export const venueConfigSchema: z.ZodType<VenueConfig> = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    center: z.object({ x: z.number(), y: z.number() }),
    numberingScheme: z.enum(['continu', 'pair-impair']),
    rows: z.array(rowSchema).min(1).max(60),
  })
  .refine((v) => new Set(v.rows.map((r) => r.label)).size === v.rows.length, {
    message: 'Les labels de rangs doivent être uniques',
  })

// Valide une config inconnue (fichier JSON, sortie du builder). Lève une
// erreur lisible en cas de problème.
export function parseVenueConfig(data: unknown, source: string): VenueConfig {
  const parsed = venueConfigSchema.safeParse(data)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')} : ${i.message}`)
      .join(' ; ')
    throw new Error(`Config de salle invalide (${source}) — ${detail}`)
  }
  return parsed.data
}
