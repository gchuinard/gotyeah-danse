// Construction d'une VenueConfig depuis un relevé en notation place.md +
// quelques paramètres de géométrie. Pour une NOUVELLE salle, on ne dispose
// pas d'un scan calibré : la géométrie générée est RÉGULIÈRE (rayons espacés
// uniformément, allées d'angle constant) — fidèle pour la numérotation et la
// contiguïté, approximative pour le dessin. Module PUR (client OK).

import type { RowConfig, VenueConfig } from '@/config/venue'

import type { ParsedRow } from './place-notation'

export type BuilderParams = {
  name: string
  premierRayon: number // rayon de la rangée la plus proche de la scène (px)
  espacement: number // entre deux rangées (px)
  pitch: number // largeur angulaire d'un siège (degrés)
  allee: number // largeur angulaire de chaque allée (degrés)
}

export const BUILDER_DEFAULTS: Omit<BuilderParams, 'name'> = {
  premierRayon: 900,
  espacement: 45,
  pitch: 0.95,
  allee: 2.5,
}

// `rows` dans l'ordre du relevé (fond → scène, comme place.md) ; la config
// produite est ordonnée scène → fond (rowOrder 0 = le plus proche de la scène).
export function buildVenueConfig(params: BuilderParams, rows: ParsedRow[]): VenueConfig {
  const { premierRayon, espacement, pitch, allee } = params
  const ordonnees = [...rows].reverse()

  return {
    name: params.name,
    center: { x: 0, y: 0 },
    numberingScheme: 'pair-impair',
    rows: ordonnees.map((row, i): RowConfig => {
      const { nNeg, nPos, removable } = row.centre
      const n = nNeg + nPos
      const centreStart = -(nNeg - 0.5) * pitch
      const centreEnd = centreStart + (n - 1) * pitch

      const arcs: RowConfig['arcs'] = []
      if (row.extJardin) {
        const fin = centreStart - allee
        arcs.push({
          section: 'gauche',
          angleStart: fin - (row.extJardin.seats - 1) * pitch,
          angleEnd: fin,
          seats: row.extJardin.seats,
          firstNumber: row.extJardin.firstNumber,
          ...(row.extJardin.removable ? { removable: true } : {}),
        })
      }
      arcs.push({
        section: 'centre',
        angleStart: centreStart,
        angleEnd: centreEnd,
        seats: n,
        ...(removable ? { removable: true } : {}),
      })
      if (row.extCour) {
        const debut = centreEnd + allee
        arcs.push({
          section: 'droite',
          angleStart: debut,
          angleEnd: debut + (row.extCour.seats - 1) * pitch,
          seats: row.extCour.seats,
          firstNumber: row.extCour.firstNumber,
          ...(row.extCour.removable ? { removable: true } : {}),
        })
      }

      return { label: row.label, radius: premierRayon + i * espacement, arcs }
    }),
  }
}
