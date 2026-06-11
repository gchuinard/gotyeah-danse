// Génération du plan de salle depuis config/venue.ts — fonction PURE.
//
// Consommée par :
//  - prisma/seed.ts          → remplit Section / Row / Seat en upsert
//  - /admin/calibration      → rend le plan SVG directement depuis la config
//                              (hot reload : on édite venue.ts, le plan bouge,
//                              pas besoin de re-seeder pendant la calibration)

import type { ArcConfig, SectionId, VenueConfig } from '@/config/venue'

export type GeneratedSeat = {
  id: string // "centre-W-03" — déterministe, sert de clé d'upsert
  section: SectionId
  sectionOrder: number // 0 = gauche, 1 = centre, 2 = droite
  rowId: string // "centre-W"
  rowLabel: string
  rowOrder: number // 0 = rang le plus proche de la scène (fosse Y)
  indexInRow: number // position dans SA section, 0 = côté jardin
  number: number // numéro affiché sur le billet
  x: number
  y: number
  angle: number // degrés
  removable: boolean
  score: number // statique 0-100
}

export const SECTION_ORDER: Record<SectionId, number> = {
  gauche: 0,
  centre: 1,
  droite: 2,
}

const toRad = (deg: number) => (deg * Math.PI) / 180

// Angles des sièges d'un arc : bornes incluses, répartition uniforme.
function arcAngles(arc: ArcConfig): number[] {
  const { angleStart, angleEnd, seats } = arc
  if (seats === 1) return [(angleStart + angleEnd) / 2]
  const step = (angleEnd - angleStart) / (seats - 1)
  return Array.from({ length: seats }, (_, i) => angleStart + i * step)
}

// Score statique 0-100 : cloche centrée sur les rangs physiquement à ~8 rangs
// de la scène (ni trop près de l'avant-scène, ni au fond) pondérée 60 %,
// + centralité angulaire 40 %. Le score dépend du rowOrder PHYSIQUE (0 = scène),
// pas du lettrage. Point de départ : l'admin peut l'ajuster siège par siège.
function staticScore(rowOrder: number, angle: number, maxAbsAngle: number): number {
  const ROW_IDEAL = 7.5 // ~8e rang depuis la scène — la fosse (Y/X) occupe les ordres 0-1
  const ROW_SPREAD = 3.5
  const bell = Math.exp(-0.5 * ((rowOrder - ROW_IDEAL) / ROW_SPREAD) ** 2)
  const centrality = maxAbsAngle === 0 ? 1 : 1 - Math.abs(angle) / maxAbsAngle
  return Math.round(100 * (0.6 * bell + 0.4 * centrality))
}

export function generateSeats(config: VenueConfig): GeneratedSeat[] {
  const { center, rows, numberingScheme } = config

  const maxAbsAngle = Math.max(
    ...rows.flatMap((r) => r.arcs.flatMap((a) => [Math.abs(a.angleStart), Math.abs(a.angleEnd)])),
  )

  const seats: GeneratedSeat[] = []

  rows.forEach((row, rowOrder) => {
    // Tous les sièges de la rangée physique, toutes sections confondues.
    // `arc` est conservé : la numérotation pair-impair en a besoin pour les
    // sauts (ArcConfig.firstNumber).
    //
    // indexInRow est attribué PAR SECTION, cumulé sur les arcs : un arc
    // `contiguousWithPrevious` continue la séquence (fauteuils qui se
    // touchent), un arc séparé saute UN index — le trou casse la contiguïté
    // du placement sans changer les ids des sièges existants (un seul arc
    // par section ⇒ comportement identique à avant).
    const prochainIndex = new Map<SectionId, number>()
    const rowSeats = row.arcs.flatMap((arc) => {
      const courant = prochainIndex.get(arc.section)
      const debut = courant === undefined ? 0 : arc.contiguousWithPrevious ? courant : courant + 1
      prochainIndex.set(arc.section, debut + arc.seats)
      return arcAngles(arc).map((angle, i) => ({
        section: arc.section,
        removable: arc.removable ?? false,
        angle,
        indexInRow: debut + i,
        arc,
      }))
    })

    const numbered = new Map<(typeof rowSeats)[number], number>()
    if (numberingScheme === 'continu') {
      // 1..N de jardin à cour sur toute la rangée.
      ;[...rowSeats]
        .sort((a, b) => a.angle - b.angle)
        .forEach((s, i) => numbered.set(s, i + 1))
    } else {
      // pair-impair : impairs côté JARDIN (négatif, terrasse accessible),
      // pairs côté COUR (positif), croissants en s'éloignant de l'axe central.
      // (Sens confirmé Gautier 2026-06-11 : la terrasse accessible est du côté
      // impair.) Un arc peut déclarer `firstNumber` (numéro de son siège le
      // plus proche de l'axe) pour reproduire les SAUTS réels de la salle ;
      // sinon la numérotation continue depuis l'arc précédent.
      const numeroter = (side: typeof rowSeats, depart: number) => {
        let prochain = depart
        let arcCourant: ArcConfig | null = null
        for (const s of side) {
          if (s.arc !== arcCourant) {
            arcCourant = s.arc
            if (s.arc.firstNumber !== undefined) {
              if (s.arc.firstNumber % 2 !== depart % 2) {
                throw new Error(
                  `Rang ${row.label} : firstNumber ${s.arc.firstNumber} de parité invalide pour ce côté ` +
                    `(attendu ${depart % 2 === 1 ? 'impair' : 'pair'}) — un arc qui chevauche l'axe ne peut pas en avoir.`,
                )
              }
              if (s.arc.firstNumber < prochain) {
                throw new Error(
                  `Rang ${row.label} : firstNumber ${s.arc.firstNumber} recule (le précédent arc s'arrête à ${prochain - 2}).`,
                )
              }
              prochain = s.arc.firstNumber
            }
          }
          numbered.set(s, prochain)
          prochain += 2
        }
      }
      const jardin = rowSeats.filter((s) => s.angle < 0).sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle))
      const cour = rowSeats.filter((s) => s.angle >= 0).sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle))
      numeroter(jardin, 1)
      numeroter(cour, 2)
    }

    for (const s of rowSeats) {
      const rad = toRad(s.angle)
      const rowId = `${s.section}-${row.label}`
      seats.push({
        id: `${rowId}-${String(s.indexInRow).padStart(2, '0')}`,
        section: s.section,
        sectionOrder: SECTION_ORDER[s.section],
        rowId,
        rowLabel: row.label,
        rowOrder,
        indexInRow: s.indexInRow,
        number: numbered.get(s)!,
        x: center.x + row.radius * Math.sin(rad) + (row.xOffset ?? 0),
        y: center.y - row.radius * Math.cos(rad),
        angle: s.angle,
        removable: s.removable,
        score: staticScore(rowOrder, s.angle, maxAbsAngle),
      })
    }
  })

  return seats
}

// Boîte englobante du plan, pour construire un viewBox SVG.
export function planBounds(seats: GeneratedSeat[], margin = 60) {
  const xs = seats.map((s) => s.x)
  const ys = seats.map((s) => s.y)
  const minX = Math.min(...xs) - margin
  const minY = Math.min(...ys) - margin
  return {
    minX,
    minY,
    width: Math.max(...xs) + margin - minX,
    height: Math.max(...ys) + margin - minY,
  }
}
