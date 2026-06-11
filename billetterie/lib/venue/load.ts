// Chargement de la config de salle ACTIVE — côté serveur uniquement (fs).
//
// Multi-salles : si VENUE_ID est défini, la salle vient du fichier
// config/venues/<VENUE_ID>.json (validé par zod, voir lib/venue/schema.ts).
// Sans VENUE_ID, la salle intégrée (Centre Culturel de Bergerac,
// config/venue.ts) fait foi. Les fichiers JSON sont produits par le créateur
// de salle (/admin/salles/nouvelle) ou écrits à la main.
//
// ⚠️ Changer de salle = re-seeder (pnpm db:seed) AVANT toute vente : le plan
// matérialisé en base (Section/Row/Seat) doit suivre la config.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { PrismaClient } from '@prisma/client'

import { venueConfig as bergerac, type VenueConfig } from '@/config/venue'

import { parseVenueConfig } from './schema'

const VENUE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i

export function loadVenueConfig(): VenueConfig {
  const venueId = process.env.VENUE_ID
  if (!venueId) return bergerac

  if (!VENUE_ID_RE.test(venueId)) {
    throw new Error(
      `VENUE_ID invalide (« ${venueId} ») : lettres, chiffres et tirets uniquement.`,
    )
  }

  const fichier = path.join(process.cwd(), 'config', 'venues', `${venueId}.json`)
  let brut: string
  try {
    brut = readFileSync(fichier, 'utf8')
  } catch {
    throw new Error(
      `Salle « ${venueId} » introuvable : ${fichier} n'existe pas. ` +
        `Déposer le fichier JSON (créateur de salle) ou retirer VENUE_ID.`,
    )
  }
  return parseVenueConfig(JSON.parse(brut), fichier)
}

// Salle ACTIVE, en tenant compte des salles enregistrées dans l'admin :
//  1. la Venue marquée isActive en base (activée depuis /admin/salles) ;
//  2. sinon le fichier VENUE_ID ;
//  3. sinon la salle intégrée (Bergerac).
// Utilisée par le seed et /admin/salles ; les outils de calibration restent
// volontairement sur loadVenueConfig (fichier/intégré, workflow scan).
export async function loadActiveVenueConfig(
  db: PrismaClient,
): Promise<{ config: VenueConfig; source: 'base' | 'fichier' | 'integree' }> {
  const active = await db.venue.findFirst({ where: { isActive: true } })
  if (active) {
    return {
      config: parseVenueConfig(JSON.parse(active.config), `salle « ${active.name} »`),
      source: 'base',
    }
  }
  return { config: loadVenueConfig(), source: process.env.VENUE_ID ? 'fichier' : 'integree' }
}
