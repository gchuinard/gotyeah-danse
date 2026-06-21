// /admin/calibration — superposition du plan généré sur le scan de la fiche
// technique pour calibrer config/venue.ts à la main (hot reload).
//
// Server component : on génère les sièges directement depuis la config
// (PAS depuis la DB) pour que chaque édition de config/venue.ts rafraîchisse
// le plan à chaud, sans re-seeder.

import type { Metadata } from 'next'

import { AISLE_AXES } from '@/config/venue'
import { requireSuperAdmin } from '@/lib/auth/require-admin'
import { loadVenueConfig } from '@/lib/venue/load'
import { generateSeats, planBounds } from '@/lib/venue/generate'

import CalibrationView from './calibration-view'

export const metadata: Metadata = {
  title: 'Calibration du plan de salle',
}

export default async function CalibrationPage() {
  await requireSuperAdmin()
  const venueConfig = loadVenueConfig()
  const seats = generateSeats(venueConfig)
  const bounds = planBounds(seats)

  return (
    <CalibrationView
      seats={seats}
      bounds={bounds}
      center={venueConfig.center}
      aisleAxes={[AISLE_AXES.jardin, AISLE_AXES.cour]}
    />
  )
}
