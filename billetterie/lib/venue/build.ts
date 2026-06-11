// Construction d'une VenueConfig depuis un relevé (notation place.md v2) +
// paramètres de géométrie. Pour une NOUVELLE salle, pas de scan calibré : la
// géométrie est RÉGULIÈRE (rayons uniformes, allées d'angle constant) —
// fidèle pour la numérotation et la contiguïté, indicative pour le dessin.
// Module PUR (client OK).

import type { ArcConfig, RowConfig, SectionId, VenueConfig } from '@/config/venue'

import type { BlocRang, ParsedRow } from './place-notation'

export type BuilderParams = {
  name: string
  premierRayon: number // rayon de la rangée la plus proche de la scène (px)
  espacement: number // entre deux rangées (px)
  pitch: number // largeur angulaire d'un siège (degrés)
  allee: number // largeur angulaire d'une séparation (degrés)
}

export const BUILDER_DEFAULTS: Omit<BuilderParams, 'name'> = {
  premierRayon: 900,
  espacement: 45,
  pitch: 0.95,
  allee: 2.5,
}

// Géométrie des arcs d'UN côté, de l'axe vers le mur (sans contiguïté — elle
// dépend de l'ordre de déclaration final, posé dans buildVenueConfig).
// Le bloc 0 appartient au CENTRE ; la première séparation bascule vers la
// section extérieure ; les suivantes sont des écarts dans cette section.
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
export function buildVenueConfig(params: BuilderParams, rows: ParsedRow[]): VenueConfig {
  const { premierRayon, espacement, pitch, allee } = params
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
      const jardin = arcsDuCote(row.jardin, 'jardin', 'gauche', pitch, allee)
      const cour = arcsDuCote(row.cour, 'cour', 'droite', pitch, allee)

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

      const radius = rayons[i]
      return {
        label: row.label,
        radius,
        arcs,
        // Décalage latéral en largeurs de siège → px à ce rayon (visuel pur).
        ...(row.decalage
          ? { xOffset: row.decalage * radius * ((pitch * Math.PI) / 180) }
          : {}),
      }
    }),
  }
}
