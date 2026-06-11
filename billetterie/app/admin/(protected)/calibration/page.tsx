// /admin/calibration — superposition du plan généré sur le scan de la fiche
// technique pour calibrer config/venue.ts à la main (hot reload).
//
// Server component : on génère les sièges directement depuis la config
// (PAS depuis la DB) pour que chaque édition de config/venue.ts rafraîchisse
// le plan à chaud, sans re-seeder.

import type { Metadata } from 'next'

import { venueConfig } from '@/config/venue'
import { generateSeats, planBounds } from '@/lib/venue/generate'

import CalibrationView from './calibration-view'

export const metadata: Metadata = {
  title: 'Calibration du plan de salle',
}

export default function CalibrationPage() {
  // Calibration = vérifier la géométrie MESURÉE contre le scan (vue régie) :
  // on génère SANS le miroir vue-salle, sinon le plan apparaît retourné par
  // rapport au scan de la fiche.
  const seats = generateSeats({ ...venueConfig, mirror: false })
  const bounds = planBounds(seats)

  return <CalibrationView seats={seats} bounds={bounds} center={venueConfig.center} />
}
