'use client'

// Créateur / éditeur de salle — l'ÉDITEUR DE RANGS est l'outil principal :
// une ligne compacte par rang (mini-barre proportionnelle, total, badges),
// qui se déplie pour éditer ses blocs (sièges, 1er n°, amovible, séparé).
// La notation reste la couche experte : ligne brute éditable dans le détail
// de chaque rang + « Importer / exporter » global replié. Le relevé texte est
// LA source de vérité — chaque modification de champ réécrit sa ligne.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import SeatMap from '@/components/admin/seat-map'
import type { SeatView } from '@/lib/admin/seat-map'
import { BUILDER_DEFAULTS, buildVenueConfig, type RowGeometry } from '@/lib/venue/build'
import { generateSeats } from '@/lib/venue/generate'
import {
  analysePlaceNotation,
  EXEMPLE_BERGERAC,
  resumeRang,
  serialiseRow,
  type BlocRang,
  type LigneAnalysee,
  type ParsedRow,
} from '@/lib/venue/place-notation'
import { parseVenueConfig } from '@/lib/venue/schema'

import { enregistrerSalle, modifierSalle } from '../actions'
import styles from './salles.module.css'

const EXEMPLE = `A 25/15 13/1 2/14 16/26
B 23/13 11/1 2/12 14/24
C (1/13) (2/14)
`

function slugifier(nom: string): string {
  return (
    nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'salle'
  )
}

// ── Mini-barre proportionnelle d'un rang (jardin → cour) ─────────────────

function BarreRang({ row }: { row: ParsedRow }) {
  const segments = [
    ...[...row.jardin].reverse().map((b, i, arr) => ({ b, gapApres: i < arr.length - 1 && arr[i].separe })),
    ...row.cour.map((b) => ({ b, gapApres: false, gapAvant: b.separe })),
  ]
  return (
    <span className={styles.barre} aria-hidden="true">
      {segments.map((s, i) => (
        <span
          key={i}
          className={s.b.removable ? styles.segAmov : styles.seg}
          style={{ flexGrow: s.b.seats, marginLeft: 'gapAvant' in s && s.gapAvant ? 4 : i > 0 && segments[i - 1].gapApres ? 4 : 0 }}
        />
      ))}
    </span>
  )
}

// ── Détail dépliable d'un rang : édition des blocs ───────────────────────

type DetailProps = {
  ligne: LigneAnalysee & { ok: true }
  onChange: (nouvelle: string) => void
  onDupliquer: () => void
  onSupprimer: () => void
  onCouloir: (actif: boolean) => void
}

function RangDetail({ ligne, onChange, onDupliquer, onSupprimer, onCouloir }: DetailProps) {
  const row = ligne.row

  const appliquer = (next: ParsedRow) => onChange(serialiseRow(next))

  const majBloc = (cote: 'jardin' | 'cour', i: number, patch: Partial<BlocRang>) => {
    const blocs = row[cote].map((b, j) => (j === i ? { ...b, ...patch } : b))
    appliquer({ ...row, [cote]: blocs })
  }

  const ajouterBloc = (cote: 'jardin' | 'cour') => {
    const dernier = row[cote][row[cote].length - 1]
    const nouveau: BlocRang = {
      seats: 2,
      firstNumber: dernier.firstNumber + 2 * dernier.seats,
      removable: false,
      separe: true,
    }
    appliquer({ ...row, [cote]: [...row[cote], nouveau] })
  }

  const supprimerBloc = (cote: 'jardin' | 'cour', i: number) => {
    appliquer({ ...row, [cote]: row[cote].filter((_, j) => j !== i) })
  }

  const cote = (nom: 'jardin' | 'cour', titre: string) => (
    <div className={styles.cote}>
      <h4>
        {titre} <small>({nom === 'jardin' ? 'impairs' : 'pairs'}, de l&apos;axe vers le mur)</small>
      </h4>
      {row[nom].map((b, i) => (
        <div key={i} className={styles.blocLigne}>
          {i > 0 && (
            <label className={styles.coche} title="Séparé du bloc précédent (allée, écart) : le placement ne regroupe pas à travers">
              <input type="checkbox" checked={b.separe} onChange={(e) => majBloc(nom, i, { separe: e.target.checked })} />
              séparé
            </label>
          )}
          <label className={styles.miniInline}>
            sièges
            <input
              type="number"
              min={1}
              max={99}
              value={b.seats}
              onChange={(e) => majBloc(nom, i, { seats: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <label className={styles.miniInline} title="Premier numéro du bloc — l'augmenter crée un saut de numérotation">
            1ᵉʳ n°
            <input
              type="number"
              min={1}
              max={999}
              step={2}
              value={b.firstNumber}
              disabled={i === 0}
              onChange={(e) => majBloc(nom, i, { firstNumber: Number(e.target.value) || b.firstNumber })}
            />
          </label>
          <span className={styles.blocPlage}>
            → {b.firstNumber + 2 * (b.seats - 1)}
          </span>
          <label className={styles.coche}>
            <input type="checkbox" checked={b.removable} onChange={(e) => majBloc(nom, i, { removable: e.target.checked })} />
            amovible
          </label>
          {i > 0 && (
            <button type="button" className={styles.blocSuppr} onClick={() => supprimerBloc(nom, i)} aria-label="Supprimer ce bloc">
              ✕
            </button>
          )}
        </div>
      ))}
      <button type="button" className={styles.blocAjout} onClick={() => ajouterBloc(nom)}>
        + bloc (strapontin, console…)
      </button>
    </div>
  )

  return (
    <div className={styles.detail}>
      <div className={styles.detailEntete}>
        <label className={styles.miniInline}>
          Lettre
          <input
            type="text"
            value={row.label}
            maxLength={3}
            onChange={(e) => {
              const label = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')
              if (label) appliquer({ ...row, label })
            }}
          />
        </label>
        <div className={styles.detailActions}>
          <button type="button" onClick={onDupliquer}>⧉ dupliquer</button>
          <button type="button" className={styles.danger} onClick={onSupprimer}>✕ supprimer le rang</button>
        </div>
      </div>

      <div className={styles.cotes}>
        {cote('jardin', 'Côté jardin')}
        {cote('cour', 'Côté cour')}
      </div>

      <div className={styles.blocLigne}>
        <label className={styles.coche} title="Espace élargi entre ce rang et le précédent (vers le fond) : couloir, terrasse…">
          <input
            type="checkbox"
            checked={row.couloirAvant === true}
            onChange={(e) => onCouloir(e.target.checked)}
          />
          couloir / terrasse avant ce rang (côté fond)
        </label>
        <label className={styles.miniInline} title="Décale tout le rang pour l'aligner — en largeurs de siège, négatif = vers jardin. Visuel uniquement.">
          décalage latéral
          <input
            type="number"
            step={0.5}
            min={-20}
            max={20}
            value={row.decalage ?? 0}
            onChange={(e) => {
              const d = Number(e.target.value) || 0
              appliquer({ ...row, decalage: d === 0 ? undefined : d })
            }}
          />
        </label>
      </div>

      {/* Couche experte : la ligne de notation, éditable telle quelle. */}
      <label className={styles.notationLigne}>
        notation
        <input
          key={ligne.source}
          type="text"
          defaultValue={ligne.source}
          spellCheck={false}
          onBlur={(e) => e.target.value.trim() !== ligne.source && onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </label>
    </div>
  )
}

// ── Vue principale ───────────────────────────────────────────────────────

export type BuilderInitial = { id: string; name: string; notation: string }

export default function BuilderView({ initial }: { initial?: BuilderInitial }) {
  const router = useRouter()
  const [nom, setNom] = useState(initial?.name ?? 'Ma salle')
  const [notation, setNotation] = useState(initial?.notation ?? EXEMPLE)
  const [deplie, setDeplie] = useState<string | null>(null) // label du rang déplié
  const [survol, setSurvol] = useState<string | null>(null)
  const [premierRayon, setPremierRayon] = useState(BUILDER_DEFAULTS.premierRayon)
  const [espacement, setEspacement] = useState(BUILDER_DEFAULTS.espacement)
  const [seatPitch, setSeatPitch] = useState(BUILDER_DEFAULTS.seatPitch)
  const [aisleWidth, setAisleWidth] = useState(BUILDER_DEFAULTS.aisleWidth)
  // Surcharges de géométrie PAR RANG (sélection) : { label: {seatPitch?, aisleWidth?} }.
  const [perRow, setPerRow] = useState<Record<string, RowGeometry>>({})
  const [selection, setSelection] = useState<string[]>([]) // lettres des rangs cochés
  const [applyPitch, setApplyPitch] = useState(BUILDER_DEFAULTS.seatPitch)
  const [applyAisle, setApplyAisle] = useState(BUILDER_DEFAULTS.aisleWidth)
  const [showGuides, setShowGuides] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const lignes = useMemo(() => analysePlaceNotation(notation), [notation])
  const valides = useMemo(
    () => lignes.filter((l): l is LigneAnalysee & { ok: true } => l.ok),
    [lignes],
  )
  const erreurs = useMemo(() => lignes.filter((l) => !l.ok), [lignes])

  const resultat = useMemo(() => {
    if (valides.length === 0) return null
    try {
      const overrides = new Map(
        Object.entries(perRow).filter(
          ([, g]) => g.seatPitch !== undefined || g.aisleWidth !== undefined,
        ),
      )
      const config = buildVenueConfig(
        { name: nom.trim() || 'Salle', premierRayon, espacement, seatPitch, aisleWidth },
        valides.map((l) => l.row),
        overrides,
      )
      return { config, seats: generateSeats(config) }
    } catch {
      return null
    }
  }, [valides, nom, premierRayon, espacement, seatPitch, aisleWidth, perRow])

  const seatViews: SeatView[] = useMemo(() => {
    if (!resultat) return []
    return resultat.seats.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      section: s.section,
      rowLabel: s.rowLabel,
      number: s.number,
      indexInRow: s.indexInRow,
      rowOrder: s.rowOrder,
      score: s.score,
      removable: s.removable,
      status: 'libre' as const,
    }))
  }, [resultat])

  const cible = survol ?? deplie
  const highlightedIds = useMemo(() => {
    if (!cible || !resultat) return undefined
    return resultat.seats.filter((s) => s.rowLabel === cible).map((s) => s.id)
  }, [cible, resultat])

  // Repères (debug) : axes radiaux des allées. Les allées du créateur sont
  // « émergentes » (centre + écart) → on trace 2 lignes à l'angle MÉDIAN des
  // allées jardin / cour, depuis le point de convergence. Indicatif : si une
  // allée d'un rang s'écarte de la ligne, ça se voit à l'œil.
  const guides = useMemo(() => {
    if (!resultat || !showGuides) return undefined
    const { rows, center } = resultat.config
    const jardin: number[] = []
    const cour: number[] = []
    let maxR = 0
    for (const row of rows) {
      maxR = Math.max(maxR, row.radius)
      const c = row.arcs.filter((a) => a.section === 'centre')
      const g = row.arcs.filter((a) => a.section === 'gauche')
      const d = row.arcs.filter((a) => a.section === 'droite')
      if (c.length && g.length) {
        jardin.push((Math.min(...c.map((a) => a.angleStart)) + Math.max(...g.map((a) => a.angleEnd))) / 2)
      }
      if (c.length && d.length) {
        cour.push((Math.max(...c.map((a) => a.angleEnd)) + Math.min(...d.map((a) => a.angleStart))) / 2)
      }
    }
    const median = (xs: number[]) =>
      xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null
    const r = maxR + 60
    const ligne = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return { x1: center.x, y1: center.y, x2: center.x + r * Math.sin(rad), y2: center.y - r * Math.cos(rad) }
    }
    const out: { x1: number; y1: number; x2: number; y2: number }[] = []
    const mj = median(jardin)
    const mc = median(cour)
    if (mj !== null) out.push(ligne(mj))
    if (mc !== null) out.push(ligne(mc))
    return out.length ? out : undefined
  }, [resultat, showGuides])

  // ── Sélection de rangs + surcharge de géométrie ────────────────────────

  const labelsValides = useMemo(() => valides.map((l) => l.row.label), [valides])

  const toggleSelection = (label: string) =>
    setSelection((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))

  const appliquerGeo = () => {
    setPerRow((prev) => {
      const next = { ...prev }
      for (const label of selection) next[label] = { seatPitch: applyPitch, aisleWidth: applyAisle }
      return next
    })
  }

  const effacerGeo = () => {
    setPerRow((prev) => {
      const next = { ...prev }
      for (const label of selection) delete next[label]
      return next
    })
  }

  const pret = erreurs.length === 0 && resultat !== null
  const totalPlaces = resultat?.seats.length ?? 0
  const amovibles = resultat?.seats.filter((s) => s.removable).length ?? 0
  const slug = slugifier(nom)

  // ── Opérations sur les lignes du relevé ────────────────────────────────

  const remplacerLigne = (numero: number, nouvelle: string | null) => {
    setNotation((n) => {
      const ls = n.split('\n')
      if (nouvelle === null) ls.splice(numero - 1, 1)
      else ls[numero - 1] = nouvelle
      return ls.join('\n')
    })
  }

  const insererApres = (numero: number, contenu: string) => {
    setNotation((n) => {
      const ls = n.split('\n')
      ls.splice(numero, 0, contenu)
      return ls.join('\n')
    })
  }

  const lettreLibre = (): string => {
    const prises = new Set(valides.map((l) => l.row.label))
    for (let c = 65; c <= 90; c++) {
      const lettre = String.fromCharCode(c)
      if (!prises.has(lettre)) return lettre
    }
    return 'Z'
  }

  const dupliquerRang = (l: LigneAnalysee & { ok: true }) => {
    insererApres(l.ligne, serialiseRow({ ...l.row, label: lettreLibre() }))
  }

  const ajouterRang = () => {
    const dernier = valides[valides.length - 1]
    const contenu = dernier
      ? serialiseRow({ ...dernier.row, label: lettreLibre() })
      : `${lettreLibre()} 9/1 2/8`
    setNotation((n) => `${n.trimEnd()}\n${contenu}\n`)
    setDeplie(null)
  }

  const deplacerRang = (l: LigneAnalysee, sens: -1 | 1) => {
    const index = lignes.indexOf(l)
    const voisin = lignes[index + sens]
    if (!voisin) return
    setNotation((n) => {
      const ls = n.split('\n')
      const a = ls[l.ligne - 1]
      ls[l.ligne - 1] = ls[voisin.ligne - 1]
      ls[voisin.ligne - 1] = a
      return ls.join('\n')
    })
  }

  // ── Enregistrement ─────────────────────────────────────────────────────

  const enregistrer = () => {
    if (!pret || !resultat) return
    setSaveError(null)
    startSaving(async () => {
      const config = JSON.parse(JSON.stringify(resultat.config))
      const name = nom.trim() || 'Salle'
      const reponse = initial
        ? await modifierSalle({ id: initial.id, name, config, notation })
        : await enregistrerSalle({ name, config, notation })
      if (!reponse.ok) {
        setSaveError(reponse.error)
        return
      }
      const active = 'active' in reponse && reponse.active === true
      router.push(
        '/admin/salles?ok=' +
          encodeURIComponent(
            initial
              ? `« ${name} » mise à jour${active ? ' — pensez à « Réappliquer le plan ».' : '.'}`
              : `« ${name} » enregistrée — activez-la quand vous voulez.`,
          ),
      )
    })
  }

  const telecharger = () => {
    if (!pret || !resultat) return
    const config = parseVenueConfig(JSON.parse(JSON.stringify(resultat.config)), 'builder')
    const blob = new Blob([JSON.stringify(config, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const chargerBergerac = () => {
    if (
      notation.trim() !== EXEMPLE.trim() &&
      notation.trim() !== '' &&
      !window.confirm('Remplacer le relevé actuel par celui du Centre Culturel de Bergerac ?')
    ) {
      return
    }
    setNotation(EXEMPLE_BERGERAC)
    if (nom === 'Ma salle') setNom('Centre Culturel (variante)')
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>{initial ? `Modifier « ${initial.name} »` : 'Créer une salle'}</h1>
        <p className={styles.intro}>
          Un rang par ligne, <strong>du fond vers la scène</strong>. Cliquez un rang pour éditer
          ses blocs (sièges, 1ᵉʳ numéro pour les sauts, amovible, séparé) — survolez-le pour le
          voir sur le plan.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.colonne}>
          <label className={styles.champ}>
            Nom de la salle
            <input type="text" value={nom} maxLength={100} onChange={(e) => setNom(e.target.value)} />
          </label>

          {/* ── L'éditeur de rangs ──────────────────────────────────────── */}
          <ul className={styles.rangs} onMouseLeave={() => setSurvol(null)}>
            {lignes.map((l) =>
              l.ok ? (
                <li key={`${l.ligne}-${l.row.label}`} className={styles.rang}>
                  {l.row.couloirAvant && (
                    <span className={styles.couloirSep} aria-label="couloir / terrasse">
                      ─ ─ couloir ─ ─
                    </span>
                  )}
                  <div className={styles.rangRangee}>
                    <input
                      type="checkbox"
                      className={styles.rangCoche}
                      checked={selection.includes(l.row.label)}
                      onChange={() => toggleSelection(l.row.label)}
                      aria-label={`Sélectionner le rang ${l.row.label}`}
                      title="Sélectionner ce rang (réglages de largeur)"
                    />
                    <button
                      type="button"
                      className={deplie === l.row.label ? styles.rangCompactOuvert : styles.rangCompact}
                      onMouseEnter={() => setSurvol(l.row.label)}
                      onClick={() => setDeplie(deplie === l.row.label ? null : l.row.label)}
                    >
                      <span className={styles.rangLettre}>{l.row.label}</span>
                      <BarreRang row={l.row} />
                      {perRow[l.row.label] && (
                        <span
                          className={styles.rangGeo}
                          title={`Largeurs spécifiques — siège ${perRow[l.row.label].seatPitch ?? seatPitch} px, allée ${perRow[l.row.label].aisleWidth ?? aisleWidth} px`}
                        >
                          ⚙
                        </span>
                      )}
                      <span className={styles.rangTotal}>
                        {resumeRang(l.row).total}
                        {resumeRang(l.row).sauts.length > 0 && (
                          <em title={`sauts : ${resumeRang(l.row).sauts.join(', ')} n'existent pas`}> ⤳</em>
                        )}
                      </span>
                      <span className={styles.rangFleches}>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          deplacerRang(l, -1)
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && deplacerRang(l, -1)}
                        aria-label="Monter (vers le fond)"
                      >
                        ↑
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          deplacerRang(l, 1)
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && deplacerRang(l, 1)}
                        aria-label="Descendre (vers la scène)"
                      >
                        ↓
                      </span>
                      </span>
                    </button>
                  </div>
                  {deplie === l.row.label && (
                    <RangDetail
                      ligne={l}
                      onChange={(nouvelle) => remplacerLigne(l.ligne, nouvelle)}
                      onDupliquer={() => dupliquerRang(l)}
                      onSupprimer={() => {
                        if (l.couloirLigne !== undefined) remplacerLigne(l.couloirLigne, null)
                        remplacerLigne(l.ligne - (l.couloirLigne !== undefined ? 1 : 0), null)
                        setDeplie(null)
                      }}
                      onCouloir={(actif) => {
                        if (actif && l.couloirLigne === undefined) insererApres(l.ligne - 1, '---')
                        else if (!actif && l.couloirLigne !== undefined) remplacerLigne(l.couloirLigne, null)
                      }}
                    />
                  )}
                </li>
              ) : (
                <li key={`err-${l.ligne}`} className={styles.rangErreur} title={l.error}>
                  <span className={styles.rangLettre}>✗</span>
                  <code>{l.source}</code>
                  <span className={styles.rangErreurMsg}>{l.error}</span>
                  <button type="button" onClick={() => remplacerLigne(l.ligne, null)} aria-label="Supprimer cette ligne">
                    ✕
                  </button>
                </li>
              ),
            )}
          </ul>

          <div className={styles.barreActionsRangs}>
            <button type="button" className={styles.blocAjout} onClick={ajouterRang}>
              + Ajouter un rang (copie du dernier)
            </button>
            <button type="button" className={styles.ghost} onClick={chargerBergerac}>
              Partir de la salle de Bergerac
            </button>
          </div>

          {/* ── Largeurs par rang (sélection) ──────────────────────────── */}
          <div className={styles.selToolbar}>
            <div className={styles.selEntete}>
              <strong>Largeurs par rang</strong>
              <span className={styles.selInfo}>
                {selection.length === 0
                  ? 'Cochez des rangs pour leur donner une largeur de siège / d’allée propre.'
                  : `${selection.length} rang${selection.length > 1 ? 's' : ''} sélectionné${selection.length > 1 ? 's' : ''}`}
              </span>
              {labelsValides.length > 0 && (
                <button
                  type="button"
                  className={styles.lien}
                  onClick={() =>
                    setSelection(selection.length === labelsValides.length ? [] : labelsValides)
                  }
                >
                  {selection.length === labelsValides.length ? 'Tout décocher' : 'Tout cocher'}
                </button>
              )}
            </div>
            <div className={styles.selChamps}>
              <label className={styles.mini}>
                Largeur d’un siège (px)
                <input
                  type="number"
                  value={applyPitch}
                  min={6}
                  max={80}
                  onChange={(e) => setApplyPitch(Number(e.target.value))}
                />
              </label>
              <label className={styles.mini}>
                Largeur des allées (px)
                <input
                  type="number"
                  value={applyAisle}
                  min={0}
                  max={200}
                  onChange={(e) => setApplyAisle(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                className={styles.blocAjout}
                disabled={selection.length === 0}
                onClick={appliquerGeo}
              >
                Appliquer aux cochés
              </button>
              <button
                type="button"
                className={styles.ghost}
                disabled={selection.length === 0}
                onClick={effacerGeo}
              >
                Réinitialiser (valeur globale)
              </button>
            </div>
          </div>

          <details className={styles.apparence}>
            <summary>Importer / exporter le relevé (notation texte)</summary>
            <textarea
              className={styles.notationGlobale}
              value={notation}
              rows={12}
              spellCheck={false}
              onChange={(e) => setNotation(e.target.value)}
            />
          </details>

          <details className={styles.apparence}>
            <summary>Géométrie globale du plan (ne change pas la numérotation)</summary>
            <div className={styles.params}>
              <label className={styles.mini}>
                Distance scène → 1ᵉʳ rang (px)
                <input type="number" value={premierRayon} min={100} max={5000} onChange={(e) => setPremierRayon(Number(e.target.value))} />
              </label>
              <label className={styles.mini}>
                Espace entre rangs (px)
                <input type="number" value={espacement} min={10} max={300} onChange={(e) => setEspacement(Number(e.target.value))} />
              </label>
              <label className={styles.mini}>
                Largeur d&apos;un siège (px)
                <input type="number" value={seatPitch} min={6} max={80} onChange={(e) => setSeatPitch(Number(e.target.value))} />
              </label>
              <label className={styles.mini}>
                Largeur des allées (px)
                <input type="number" value={aisleWidth} min={0} max={200} onChange={(e) => setAisleWidth(Number(e.target.value))} />
              </label>
            </div>
            <p className={styles.apparenceNote}>
              En pixels (longueurs réelles, pas des angles) : le fond de la salle ne se dilate plus.
              Pour donner une largeur propre à certains rangs, cochez-les ci-dessus.
            </p>
          </details>

          {saveError && (
            <p className={styles.erreur} role="alert">
              {saveError}
            </p>
          )}

          <button type="button" className={styles.telecharger} onClick={enregistrer} disabled={!pret || saving}>
            {saving ? 'Enregistrement…' : initial ? 'Enregistrer les modifications' : 'Enregistrer dans la billetterie'}
          </button>
          <button type="button" className={styles.secondaire} onClick={telecharger} disabled={!pret}>
            Télécharger {slug}.json (sauvegarde fichier)
          </button>
        </section>

        <section className={styles.apercu}>
          <p className={styles.statsBar} role="status">
            {valides.length} rang{valides.length > 1 ? 's' : ''} · {totalPlaces} places
            {amovibles > 0 ? ` (dont ${amovibles} amovibles)` : ''}
            {erreurs.length > 0 && (
              <strong className={styles.statsErreurs}>
                {' '}
                · {erreurs.length} ligne{erreurs.length > 1 ? 's' : ''} en erreur
              </strong>
            )}
            <label className={styles.guideToggle}>
              <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
              axes des allées
            </label>
          </p>

          {resultat ? (
            <SeatMap
              seats={seatViews}
              highlightedIds={highlightedIds}
              guides={guides}
              caption={`Aperçu — ${nom || 'salle'} (géométrie indicative)`}
            />
          ) : (
            <p className={styles.apercuVide}>
              L&apos;aperçu s&apos;affichera dès qu&apos;un rang est valide — « + Ajouter un rang ».
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
