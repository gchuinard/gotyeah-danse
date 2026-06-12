// Construction d'une VenueConfig depuis un relevé (notation place.md v2) +
// paramètres de géométrie. Pour une NOUVELLE salle, pas de scan calibré : la
// géométrie est RÉGULIÈRE (rayons uniformes, allées d'angle constant) —
// fidèle pour la numérotation et la contiguïté, indicative pour le dessin.
//
// Géométrie en UNITÉS LINÉAIRES (px), comme config/venue.ts : la largeur d'un
// siège (seatPitch) et d'une allée (aisleWidth) sont des LONGUEURS constantes,
// pas des angles — sinon le fond de la salle se dilate (largeur = angle ×
// rayon). L'angle se déduit du rayon : angle = longueur / rayon.
//
// Chaque rang peut surcharger seatPitch / aisleWidth (sélection de rangs dans
// le créateur) ; sinon la valeur globale s'applique. Module PUR (client OK).

import type { ArcConfig, RowConfig, SectionId, VenueConfig } from '@/config/venue'

import type { BlocRang, ParsedRow } from './place-notation'

export type BuilderParams = {
  name: string
  premierRayon: number // rayon de la rangée la plus proche de la scène (px)
  espacement: number // entre deux rangées (px)
  seatPitch: number // largeur d'un fauteuil (px) — entraxe
  aisleWidth: number // largeur d'une allée verticale (px)
}

// Surcharge de géométrie pour un rang donné (par sélection dans le créateur).
export type RowGeometry = { seatPitch?: number; aisleWidth?: number }

export const BUILDER_DEFAULTS: Omit<BuilderParams, 'name'> = {
  premierRayon: 900,
  espacement: 45,
  seatPitch: 22, // px — ≈ largeur réelle d'un fauteuil + accoudoir
  aisleWidth: 40, // px — une allée
}

const degParPx = (radius: number) => 180 / (Math.PI * radius)

// Géométrie des arcs d'UN côté, de l'axe vers le mur (sans contiguïté — elle
// dépend de l'ordre de déclaration final, posé dans buildVenueConfig).
// Le bloc 0 appartient au CENTRE ; la première séparation bascule vers la
// section extérieure ; les suivantes sont des écarts dans cette section.
// pitch / allee sont des ANGLES (degrés), déjà dérivés du rayon du rang.
function arcsDuCote(
  blocs: BlocRang[],
  cote: 'jardin' | 'cour',
  exterieure: SectionId,
  pitch: number,
  allee: number,
): ArcConfig[] {
  const arcs: ArcConfig[] = []
  let angle = 0.5 * pitch // bord intérieur du prochain arc (depuis l'axe)
  let section: SectionId = 'centre'

  blocs.forEach((bloc, i) => {
    if (bloc.separe) {
      angle += allee
      if (section === 'centre') section = exterieure
    }
    const debut = angle
    const fin = debut + (bloc.seats - 1) * pitch
    angle = fin + pitch

    arcs.push({
      section,
      // côté jardin : angles négatifs, bornes inversées (angleStart < angleEnd)
      angleStart: cote === 'jardin' ? -fin : debut,
      angleEnd: cote === 'jardin' ? -debut : fin,
      seats: bloc.seats,
      ...(i > 0 ? { firstNumber: bloc.firstNumber } : {}),
      ...(bloc.removable ? { removable: true } : {}),
    })
  })
  return arcs
}

// `rows` dans l'ordre du relevé (fond → scène) ; la config produite est
// ordonnée scène → fond (rowOrder 0 = le plus proche de la scène).
// `perRow` : surcharges de géométrie par lettre de rang (créateur).
export function buildVenueConfig(
  params: BuilderParams,
  rows: ParsedRow[],
  perRow: Map<string, RowGeometry> = new Map(),
): VenueConfig {
  const { premierRayon, espacement, seatPitch, aisleWidth } = params
  const ordonnees = [...rows].reverse()

  // Rayons cumulés : un couloir (---) élargit l'espace entre deux rangs.
  // couloirAvant est « côté fond » dans le relevé ; en ordre scène → fond,
  // l'écart élargi s'applique en QUITTANT le rang qui le porte.
  const rayons: number[] = []
  let r = premierRayon
  for (let i = 0; i < ordonnees.length; i++) {
    rayons.push(r)
    r += espacement * (ordonnees[i].couloirAvant ? 2.4 : 1)
  }

  return {
    name: params.name,
    center: { x: 0, y: 0 },
    numberingScheme: 'pair-impair',
    rows: ordonnees.map((row, i): RowConfig => {
      const radius = rayons[i]
      // Géométrie effective de CE rang (surcharge éventuelle), convertie en
      // angles à ce rayon : pas linéaire → pas angulaire.
      const geo = perRow.get(row.label)
      const pitchPx = geo?.seatPitch ?? seatPitch
      const aislePx = geo?.aisleWidth ?? aisleWidth
      const pitchDeg = pitchPx * degParPx(radius)
      const alleeDeg = aislePx * degParPx(radius)

      const jardin = arcsDuCote(row.jardin, 'jardin', 'gauche', pitchDeg, alleeDeg)
      const cour = arcsDuCote(row.cour, 'cour', 'droite', pitchDeg, alleeDeg)

      // Déclaration en ordre PHYSIQUE (mur jardin → axe → mur cour) : c'est
      // l'ordre qui pilote indexInRow, donc la contiguïté du placement.
      // bloc.separe décrit la frontière d'un bloc avec son voisin CÔTÉ AXE :
      //  - jardin déclaré mur→axe : l'arc j est contigu au précédent déclaré
      //    (son voisin extérieur, bloc nJ-j) si CE voisin n'est pas séparé ;
      //  - 1er bloc cour : contigu à la moitié jardin du centre (à travers
      //    l'axe — une famille peut être assise à cheval) ;
      //  - blocs cour suivants : contigus si non séparés.
      const nJ = row.jardin.length
      const arcs: ArcConfig[] = []
      for (let j = nJ - 1; j >= 0; j--) {
        const contigu = j < nJ - 1 && !row.jardin[j + 1].separe
        arcs.push({ ...jardin[j], ...(contigu ? { contiguousWithPrevious: true } : {}) })
      }
      row.cour.forEach((bloc, j) => {
        const contigu = j === 0 ? nJ > 0 : !bloc.separe
        arcs.push({ ...cour[j], ...(contigu ? { contiguousWithPrevious: true } : {}) })
      })

      return {
        label: row.label,
        radius,
        arcs,
        // Décalage latéral en largeurs de siège → px (visuel pur) :
        // decalage × pitchPx (à ce rayon, pitchDeg·rad = pitchPx/radius).
        ...(row.decalage ? { xOffset: row.decalage * pitchPx } : {}),
      }
    }),
  }
}
