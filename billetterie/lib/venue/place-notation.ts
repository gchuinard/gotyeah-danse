// Notation « place.md » v2 — le format compact dans lequel on relève une
// salle sur sa fiche technique, une ligne par rang, écrite dans l'ordre
// PHYSIQUE (mur jardin → mur cour) :
//
//   B 37/19 17/1 2/18 20/38            rang classique : ext jardin, milieu
//                                      impair, milieu pair, ext cour
//   A 45/1 2/44                        rang continu (pas d'allées)
//   X (1/15) (2/16)                    fosse : parenthèses = amovible
//   H 35/17 15/9 (7/1) (2/8) 10/16 18/36   console : le centre est scindé,
//                                      seuls les 8 sièges centraux sont
//                                      amovibles (blocs CONTIGUS)
//   Z 9/1 2/8 | 13/11                  « | » = bloc SÉPARÉ (strapontin, écart)
//
// Sémantique des séparations : par défaut, le bloc le plus EXTÉRIEUR de
// chaque côté (s'il y en a plusieurs) est séparé du reste par une allée — le
// cas classique. Un « | » rend la séparation explicite n'importe où. Les
// autres blocs voisins sont contigus (fauteuils qui se touchent : console).
//
// Un flag final 1 ou 12 est accepté et ignoré (position du centre). Les
// SAUTS de numérotation réels sont capturés : chaque bloc porte son premier
// numéro explicite.
//
// Module PUR (zéro dépendance Node) : tourne aussi côté client (éditeur).

import type { VenueConfig } from '@/config/venue'

import { generateSeats } from './generate'

// Un bloc d'un côté, de l'axe vers le mur. `separe` = séparé du bloc
// précédent (plus proche de l'axe) : allée ou écart physique — la contiguïté
// du placement s'y arrête. Le bloc 0 commence à 1 (jardin) ou 2 (cour).
export type BlocRang = {
  seats: number
  firstNumber: number
  removable: boolean
  separe: boolean
}

export type ParsedRow = {
  label: string
  jardin: BlocRang[] // impairs, de l'axe vers le mur
  cour: BlocRang[] // pairs, de l'axe vers le mur
}

type Groupe = {
  lo: number
  hi: number
  seats: number
  impair: boolean
  removable: boolean
  pipeAvant: boolean // un « | » précédait ce groupe dans la ligne
}

function parseGroupes(tokens: string[], ligne: string): Groupe[] {
  const groupes: Groupe[] = []
  let pipe = false
  for (const token of tokens) {
    if (token === '|') {
      if (pipe || groupes.length === 0) {
        throw new Error(`« ${ligne} » : « | » mal placé (il sépare deux blocs).`)
      }
      pipe = true
      continue
    }
    const removable = token.startsWith('(') && token.endsWith(')')
    const nu = removable ? token.slice(1, -1) : token
    const m = /^(\d{1,3})\/(\d{1,3})$/.exec(nu)
    if (!m) throw new Error(`« ${ligne} » : bloc illisible « ${token} » (attendu n/m, ex. 17/1).`)
    const a = Number(m[1])
    const b = Number(m[2])
    if (a % 2 !== b % 2) throw new Error(`« ${ligne} » : bloc « ${token} » mélange pairs et impairs.`)
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    groupes.push({ lo, hi, seats: (hi - lo) / 2 + 1, impair: lo % 2 === 1, removable, pipeAvant: pipe })
    pipe = false
  }
  if (pipe) throw new Error(`« ${ligne} » : « | » en fin de ligne.`)
  return groupes
}

// Transforme les groupes d'UN côté (ordonnés de l'axe vers le mur) en blocs.
// `pipes` : séparations explicites entre voisins physiques de ce côté.
function blocsDuCote(
  groupes: Groupe[],
  pipes: boolean[],
  ligneAPipes: boolean,
  premier: number,
  cote: string,
  ligne: string,
): BlocRang[] {
  if (groupes[0].lo !== premier) {
    throw new Error(`« ${ligne} » : le bloc ${cote} le plus proche de l'axe doit commencer à ${premier}.`)
  }
  return groupes.map((g, i) => {
    if (i > 0 && g.lo <= groupes[i - 1].hi) {
      throw new Error(`« ${ligne} » : blocs ${cote} dans le désordre ou qui se chevauchent (${g.lo} après ${groupes[i - 1].hi}).`)
    }
    // Séparation : « | » explicite, sinon règle par défaut — sans aucun « | »
    // dans la ligne, le bloc le plus extérieur est derrière l'allée.
    const separe =
      i === 0 ? false : ligneAPipes ? pipes[i] : i === groupes.length - 1
    return { seats: g.seats, firstNumber: g.lo, removable: g.removable, separe }
  })
}

export function parsePlaceLine(ligne: string): ParsedRow {
  const nettoyee = ligne.trim()
  // « | » peut être collé aux blocs : on l'isole.
  const tokens = nettoyee.replace(/\|/g, ' | ').split(/\s+/).filter(Boolean)
  const label = tokens.shift() ?? ''
  if (!/^[A-Z]{1,3}$/i.test(label)) {
    throw new Error(`« ${nettoyee} » : la ligne doit commencer par la lettre du rang.`)
  }
  if (tokens.length > 0 && /^(1|12)$/.test(tokens[tokens.length - 1])) tokens.pop()
  if (tokens.length === 0) throw new Error(`« ${nettoyee} » : aucun bloc de places.`)

  const groupes = parseGroupes(tokens, nettoyee)
  const ligneAPipes = groupes.some((g) => g.pipeAvant)

  // La ligne est écrite jardin → cour : tous les impairs d'abord, puis les pairs.
  const bascule = groupes.findIndex((g) => !g.impair)
  if (bascule === -1 || bascule === 0) {
    throw new Error(`« ${nettoyee} » : il faut des blocs impairs (jardin) PUIS pairs (cour).`)
  }
  if (groupes.slice(bascule).some((g) => g.impair)) {
    throw new Error(`« ${nettoyee} » : blocs impairs et pairs mélangés — écrire jardin puis cour.`)
  }

  // Jardin : écrit du mur vers l'axe → on inverse pour partir de l'axe.
  // La séparation d'un bloc jardin est le « | » côté axe, c'est-à-dire le
  // pipeAvant du groupe SUIVANT dans l'ordre écrit.
  const jardinEcrits = groupes.slice(0, bascule)
  const jardinAxe = [...jardinEcrits].reverse()
  const pipesJardin = jardinAxe.map((_, i) => (i === 0 ? false : jardinEcrits[jardinEcrits.length - i].pipeAvant))
  // Cour : écrit de l'axe vers le mur — ordre déjà bon, pipes directs.
  const courAxe = groupes.slice(bascule)
  const pipesCour = courAxe.map((g, i) => (i === 0 ? false : g.pipeAvant))

  return {
    label: label.toUpperCase(),
    jardin: blocsDuCote(jardinAxe, pipesJardin, ligneAPipes, 1, 'jardin', nettoyee),
    cour: blocsDuCote(courAxe, pipesCour, ligneAPipes, 2, 'cour', nettoyee),
  }
}

// Parse un relevé complet (une ligne par rang, # = commentaire, vide ignoré).
// Rangs dans l'ordre du texte (fond → scène, comme une fiche).
export function parsePlaceNotation(texte: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  const labels = new Set<string>()
  for (const brute of texte.split('\n')) {
    const ligne = brute.trim()
    if (ligne === '' || ligne.startsWith('#')) continue
    const row = parsePlaceLine(ligne)
    if (labels.has(row.label)) throw new Error(`Rang « ${row.label} » en double.`)
    labels.add(row.label)
    rows.push(row)
  }
  if (rows.length === 0) throw new Error('Aucun rang : une ligne par rang, ex. « B 37/19 17/1 2/18 20/38 ».')
  return rows
}

// Analyse LIGNE PAR LIGNE, sans s'arrêter à la première erreur (éditeur).
export type LigneAnalysee =
  | { ligne: number; source: string; ok: true; row: ParsedRow }
  | { ligne: number; source: string; ok: false; error: string }

export function analysePlaceNotation(texte: string): LigneAnalysee[] {
  const out: LigneAnalysee[] = []
  const labels = new Set<string>()
  texte.split('\n').forEach((brute, index) => {
    const ligne = brute.trim()
    if (ligne === '' || ligne.startsWith('#')) return
    try {
      const row = parsePlaceLine(ligne)
      if (labels.has(row.label)) throw new Error(`Rang « ${row.label} » en double.`)
      labels.add(row.label)
      out.push({ ligne: index + 1, source: ligne, ok: true, row })
    } catch (error) {
      out.push({
        ligne: index + 1,
        source: ligne,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
  return out
}

// ── Sérialisation inverse ────────────────────────────────────────────────

function blocVersGroupe(b: BlocRang, impair: boolean): string {
  const hi = b.firstNumber + 2 * (b.seats - 1)
  const corps = impair ? `${hi}/${b.firstNumber}` : `${b.firstNumber}/${hi}`
  return b.removable ? `(${corps})` : corps
}

// Rang → ligne de notation. Émet des « | » explicites pour toutes les
// séparations : sans ambiguïté, et re-parse à l'identique.
export function serialiseRow(row: ParsedRow): string {
  const morceaux: string[] = [row.label]
  const jardinEcrits = [...row.jardin].reverse() // mur → axe
  jardinEcrits.forEach((b, i) => {
    morceaux.push(blocVersGroupe(b, true))
    const suivantVersAxe = jardinEcrits[i + 1] // plus proche de l'axe
    if (suivantVersAxe === undefined) return
    if (b.separe) morceaux.push('|')
  })
  row.cour.forEach((b) => {
    if (b.separe) morceaux.push('|')
    morceaux.push(blocVersGroupe(b, false))
  })
  return morceaux.join(' ').replace(/\s+\|/g, ' |')
}

// VenueConfig → relevé complet (pour ÉDITER une salle enregistrée). On passe
// par les sièges générés : robuste quelle que soit la façon dont la config a
// été écrite. Les blocs sont reconstruits par côté : rupture d'indexInRow ou
// changement de section = séparé ; changement d'amovible ou saut de
// numérotation = nouveau bloc contigu.
export function serialiseVenueConfig(config: VenueConfig): string {
  if (config.numberingScheme !== 'pair-impair') {
    throw new Error('Seules les salles en numérotation pair-impair sont éditables ici.')
  }
  const seats = generateSeats(config)
  const lignes: string[] = []
  // rows de la config : scène → fond ; le relevé s'écrit fond → scène.
  for (const rowConfig of [...config.rows].reverse()) {
    const duRang = seats.filter((s) => s.rowLabel === rowConfig.label)
    const cote = (impair: boolean): BlocRang[] => {
      const liste = duRang
        .filter((s) => (s.number % 2 === 1) === impair)
        .sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle))
      const blocs: BlocRang[] = []
      for (const s of liste) {
        const courant = blocs[blocs.length - 1]
        const precedent = courant ? liste[blocs.reduce((n, b) => n + b.seats, 0) - 1] : undefined
        const rupture =
          precedent === undefined ||
          s.section !== precedent.section ||
          Math.abs(s.indexInRow - precedent.indexInRow) !== 1
        const nouveauBloc =
          courant === undefined ||
          rupture ||
          s.removable !== (courant.removable ?? false) ||
          s.number !== courant.firstNumber + 2 * courant.seats
        if (nouveauBloc) {
          blocs.push({
            seats: 1,
            firstNumber: s.number,
            removable: s.removable,
            separe: blocs.length > 0 && rupture,
          })
        } else {
          courant.seats += 1
        }
      }
      return blocs
    }
    lignes.push(serialiseRow({ label: rowConfig.label, jardin: cote(true), cour: cote(false) }))
  }
  return lignes.join('\n') + '\n'
}

// ── Résumé lisible d'un rang ─────────────────────────────────────────────

export type ResumeRang = {
  total: number
  impairs: string // ex. « 1→13, 17→31 »
  pairs: string
  sauts: number[] // numéros qui n'existent pas
  amovibles: number
}

export function resumeRang(row: ParsedRow): ResumeRang {
  const sauts: number[] = []
  const plages = (blocs: BlocRang[]): string =>
    blocs
      .map((b, i) => {
        if (i > 0) {
          const attendu = blocs[i - 1].firstNumber + 2 * blocs[i - 1].seats
          for (let n = attendu; n < b.firstNumber; n += 2) sauts.push(n)
        }
        const hi = b.firstNumber + 2 * (b.seats - 1)
        return b.seats === 1 ? `${b.firstNumber}` : `${b.firstNumber}→${hi}`
      })
      .join(', ')

  const impairs = plages(row.jardin)
  const pairs = plages(row.cour)
  const tous = [...row.jardin, ...row.cour]
  return {
    total: tous.reduce((n, b) => n + b.seats, 0),
    impairs,
    pairs,
    sauts: sauts.sort((a, b) => a - b),
    amovibles: tous.filter((b) => b.removable).reduce((n, b) => n + b.seats, 0),
  }
}

// ── Relevé réel du Centre Culturel de Bergerac ───────────────────────────
// place.md tel quel, console H/I EXACTE (les 8 sièges centraux amovibles).
export const EXEMPLE_BERGERAC = `# Centre Culturel de Bergerac — du FOND (A) vers la SCÈNE (Y)
A 45/1 2/44
B 37/19 17/1 2/18 20/38
C 35/19 17/1 2/18 20/36
D 33/17 15/1 2/16 18/34
E 33/17 15/1 2/16 18/34
F 33/17 15/1 2/14 16/32
G 31/17 15/1 2/14 16/30
H 35/17 15/9 (7/1) (2/8) 10/16 18/36
I 35/17 15/9 (7/1) (2/8) 10/16 18/36
J 35/17 15/1 2/14 16/34
K 33/17 15/1 2/14 16/32
L 33/17 15/1 2/14 16/32
M 33/17 13/1 2/14 16/32
N 29/15 13/1 2/14 16/30
O 31/17 13/1 2/12 16/30
P 29/15 13/1 2/12 14/28
Q 29/15 13/1 2/12 14/28
R 27/15 11/1 2/12 16/28
S 27/13 11/1 2/12 14/26
T 27/15 11/1 2/10 14/26
U 25/13 11/1 2/10 12/24
V 25/13 11/1 2/10 12/22
W (21/11) 9/1 2/10 12/22
X (1/15) (2/16)
Y (1/15) (2/16)
`
