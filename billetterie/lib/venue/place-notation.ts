// Parser de la notation « place.md » — le format compact dans lequel on
// relève une salle sur sa fiche technique, une ligne par rang :
//
//   B 37/19 17/1 2/18 20/38      rang standard : extérieur jardin (impairs
//                                hauts), milieu impair, milieu pair,
//                                extérieur cour (pairs hauts)
//   A 45/1 2/44                  rang continu (pas d'allées)
//   X (1/15) (2/16)              fosse : parenthèses = amovible
//   W (21/11) 9/1 2/10 12/22     extérieur jardin amovible
//
// Un flag final 1 ou 12 (centre « sur le 1 » ou « entre 1 et 2 ») est accepté
// et ignoré : la numérotation se déduit des plages. Les SAUTS de numérotation
// réels (ex. pairs 12 puis 16) sont capturés : le premier numéro de chaque
// bloc extérieur devient ArcConfig.firstNumber.
//
// Module PUR (zéro dépendance Node) : tourne aussi côté client pour l'aperçu
// live du créateur de salle.

export type ParsedRow = {
  label: string
  // Moitiés du centre : nNeg impairs (1,3,…) côté jardin, nPos pairs côté cour.
  centre: { nNeg: number; nPos: number; removable: boolean }
  extJardin?: { seats: number; firstNumber: number; removable: boolean }
  extCour?: { seats: number; firstNumber: number; removable: boolean }
}

type Groupe = { lo: number; hi: number; seats: number; impair: boolean; removable: boolean }

function parseGroupe(token: string, ligne: string): Groupe {
  const removable = token.startsWith('(') && token.endsWith(')')
  const nu = removable ? token.slice(1, -1) : token
  const m = /^(\d{1,3})\/(\d{1,3})$/.exec(nu)
  if (!m) throw new Error(`« ${ligne} » : groupe illisible « ${token} » (attendu n/m, ex. 17/1).`)
  const a = Number(m[1])
  const b = Number(m[2])
  if (a % 2 !== b % 2) {
    throw new Error(`« ${ligne} » : groupe « ${token} » mélange pairs et impairs.`)
  }
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return { lo, hi, seats: (hi - lo) / 2 + 1, impair: lo % 2 === 1, removable }
}

export function parsePlaceLine(ligne: string): ParsedRow {
  const nettoyee = ligne.trim()
  const tokens = nettoyee.split(/\s+/)
  const label = tokens.shift() ?? ''
  if (!/^[A-Z]{1,3}$/i.test(label)) {
    throw new Error(`« ${nettoyee} » : la ligne doit commencer par la lettre du rang.`)
  }

  // Flag final 1 / 12 : position du centre, sans effet sur la numérotation.
  if (tokens.length > 0 && /^(1|12)$/.test(tokens[tokens.length - 1])) tokens.pop()

  if (tokens.length === 0) throw new Error(`« ${nettoyee} » : aucun groupe de places.`)
  const groupes = tokens.map((t) => parseGroupe(t, nettoyee))

  const impairs = groupes.filter((g) => g.impair)
  const pairs = groupes.filter((g) => !g.impair)
  if (impairs.length === 0 || pairs.length === 0) {
    throw new Error(`« ${nettoyee} » : il faut au moins un groupe impair et un groupe pair.`)
  }
  if (impairs.length > 2 || pairs.length > 2) {
    throw new Error(
      `« ${nettoyee} » : plus de 2 groupes d'une même parité — sous-découpage non géré ` +
        `(fusionner les plages, et marquer le centre amovible si besoin).`,
    )
  }

  // Le groupe qui contient 1 (resp. 2) est la moitié de centre ; l'autre,
  // s'il existe, est le bloc extérieur.
  const centreImp = impairs.find((g) => g.lo === 1)
  const centrePair = pairs.find((g) => g.lo === 2)
  if (!centreImp) throw new Error(`« ${nettoyee} » : aucun groupe impair ne commence à 1.`)
  if (!centrePair) throw new Error(`« ${nettoyee} » : aucun groupe pair ne commence à 2.`)
  const extImp = impairs.find((g) => g !== centreImp)
  const extPair = pairs.find((g) => g !== centrePair)

  for (const [ext, centre, cote] of [
    [extImp, centreImp, 'jardin'],
    [extPair, centrePair, 'cour'],
  ] as const) {
    if (ext && ext.lo <= centre.hi) {
      throw new Error(
        `« ${nettoyee} » : l'extérieur ${cote} (${ext.lo}…) chevauche le milieu (…${centre.hi}).`,
      )
    }
  }

  return {
    label: label.toUpperCase(),
    centre: {
      nNeg: centreImp.seats,
      nPos: centrePair.seats,
      removable: centreImp.removable && centrePair.removable,
    },
    ...(extImp
      ? { extJardin: { seats: extImp.seats, firstNumber: extImp.lo, removable: extImp.removable } }
      : {}),
    ...(extPair
      ? { extCour: { seats: extPair.seats, firstNumber: extPair.lo, removable: extPair.removable } }
      : {}),
  }
}

// Parse un relevé complet (une ligne par rang, # = commentaire, vide ignoré).
// Renvoie les rangs DANS L'ORDRE DU TEXTE (en général fond → scène, comme on
// lit une fiche) — c'est au constructeur de salle de les remettre scène → fond.
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

// Relevé réel du Centre Culturel de Bergerac (place.md, sauts compris ; la
// console H/I est approximée centre-entier-amovible comme dans venue.ts).
// Point de départ proposé par le créateur de salle, validé par les tests.
export const EXEMPLE_BERGERAC = `# Centre Culturel de Bergerac — du FOND (A) vers la SCÈNE (Y)
A 45/1 2/44
B 37/19 17/1 2/18 20/38
C 35/19 17/1 2/18 20/36
D 33/17 15/1 2/16 18/34
E 33/17 15/1 2/16 18/34
F 33/17 15/1 2/14 16/32
G 31/17 15/1 2/14 16/30
H 35/17 (15/1) (2/16) 18/36
I 35/17 (15/1) (2/16) 18/36
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

// Analyse LIGNE PAR LIGNE, sans s'arrêter à la première erreur — pour
// l'éditeur du créateur de salle (feedback par rang, erreurs localisées).
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

// Résumé lisible d'un rang : plages réelles, sauts de numérotation, total.
export type ResumeRang = {
  total: number
  impairs: string // ex. « 1→13, 17→31 »
  pairs: string
  sauts: number[] // numéros qui n'existent pas (détectés entre milieu et ext)
  amovibles: number
}

export function resumeRang(row: ParsedRow): ResumeRang {
  const sauts: number[] = []
  const plage = (de: number, n: number) => (n === 1 ? `${de}` : `${de}→${de + 2 * (n - 1)}`)

  const impParts = [plage(1, row.centre.nNeg)]
  if (row.extJardin) {
    const attendu = 2 * row.centre.nNeg + 1
    for (let n = attendu; n < row.extJardin.firstNumber; n += 2) sauts.push(n)
    impParts.push(plage(row.extJardin.firstNumber, row.extJardin.seats))
  }
  const pairParts = [plage(2, row.centre.nPos)]
  if (row.extCour) {
    const attendu = 2 * row.centre.nPos + 2
    for (let n = attendu; n < row.extCour.firstNumber; n += 2) sauts.push(n)
    pairParts.push(plage(row.extCour.firstNumber, row.extCour.seats))
  }

  const amovibles =
    (row.centre.removable ? row.centre.nNeg + row.centre.nPos : 0) +
    (row.extJardin?.removable ? row.extJardin.seats : 0) +
    (row.extCour?.removable ? row.extCour.seats : 0)

  return {
    total: row.centre.nNeg + row.centre.nPos + (row.extJardin?.seats ?? 0) + (row.extCour?.seats ?? 0),
    impairs: impParts.join(', '),
    pairs: pairParts.join(', '),
    sauts: sauts.sort((a, b) => a - b),
    amovibles,
  }
}
