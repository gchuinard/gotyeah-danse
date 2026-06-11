'use client'

// Créateur de salle — éditeur guidé de la notation place.md :
//  - assistant « Ajouter un rang » : des champs simples écrivent la ligne ;
//  - analyse LIGNE PAR LIGNE : chips par rang (erreurs localisées), survol
//    d'un chip → le rang s'illumine sur le plan, clic → la ligne est
//    sélectionnée dans l'éditeur ;
//  - « Partir de la salle de Bergerac » : précharge le relevé réel ;
//  - aperçu live + enregistrement en base (activation dans /admin/salles).

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import SeatMap from '@/components/admin/seat-map'
import type { SeatView } from '@/lib/admin/seat-map'
import { BUILDER_DEFAULTS, buildVenueConfig } from '@/lib/venue/build'
import { generateSeats } from '@/lib/venue/generate'
import { analysePlaceNotation, EXEMPLE_BERGERAC, resumeRang } from '@/lib/venue/place-notation'
import { parseVenueConfig } from '@/lib/venue/schema'

import { enregistrerSalle } from '../actions'
import styles from './salles.module.css'

const EXEMPLE = `# Une ligne par rang, du FOND vers la SCÈNE — ou utilisez
# l'assistant « Ajouter un rang » ci-dessous, qui écrit les lignes pour vous.
A 25/15 13/1 2/14 16/26
B 23/13 11/1 2/12 14/24
C (1/13) (2/14)
`

type TypeRang = 'blocs' | 'continu' | 'fosse'

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

function lettreSuivante(derniere: string | undefined): string {
  if (!derniere || derniere.length !== 1) return 'A'
  const code = derniere.charCodeAt(0)
  return code >= 65 && code < 90 ? String.fromCharCode(code + 1) : ''
}

export default function BuilderView() {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const [nom, setNom] = useState('Ma salle')
  const [notation, setNotation] = useState(EXEMPLE)
  const [premierRayon, setPremierRayon] = useState(BUILDER_DEFAULTS.premierRayon)
  const [espacement, setEspacement] = useState(BUILDER_DEFAULTS.espacement)
  const [pitch, setPitch] = useState(BUILDER_DEFAULTS.pitch)
  const [allee, setAllee] = useState(BUILDER_DEFAULTS.allee)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const [survol, setSurvol] = useState<string | null>(null)

  // Assistant « Ajouter un rang ».
  const [aLettre, setALettre] = useState('')
  const [aType, setAType] = useState<TypeRang>('blocs')
  const [aExtJ, setAExtJ] = useState(8)
  const [aMilImp, setAMilImp] = useState(7)
  const [aMilPair, setAMilPair] = useState(7)
  const [aExtC, setAExtC] = useState(8)
  const [aAmovExtJ, setAAmovExtJ] = useState(false)
  const [aAmovCentre, setAAmovCentre] = useState(false)
  const [aAmovExtC, setAAmovExtC] = useState(false)

  // Analyse ligne par ligne : les rangs valides nourrissent l'aperçu, les
  // erreurs restent localisées (on ne perd pas le plan pour une coquille).
  const lignes = useMemo(() => analysePlaceNotation(notation), [notation])
  const valides = useMemo(() => lignes.filter((l) => l.ok), [lignes])
  const erreurs = useMemo(() => lignes.filter((l) => !l.ok), [lignes])

  const resultat = useMemo(() => {
    if (valides.length === 0) return null
    try {
      const config = buildVenueConfig(
        { name: nom.trim() || 'Salle', premierRayon, espacement, pitch, allee },
        valides.map((l) => l.row),
      )
      return { config, seats: generateSeats(config) }
    } catch {
      return null
    }
  }, [valides, nom, premierRayon, espacement, pitch, allee])

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

  const highlightedIds = useMemo(() => {
    if (!survol || !resultat) return undefined
    return resultat.seats.filter((s) => s.rowLabel === survol).map((s) => s.id)
  }, [survol, resultat])

  const pret = erreurs.length === 0 && resultat !== null
  const totalPlaces = resultat?.seats.length ?? 0
  const amovibles = resultat?.seats.filter((s) => s.removable).length ?? 0
  const slug = slugifier(nom)

  const lettreParDefaut = lettreSuivante(valides.at(-1)?.row.label)

  // Construit la ligne de notation depuis l'assistant.
  const construireLigne = (): string | null => {
    const lettre = (aLettre.trim() || lettreParDefaut).toUpperCase()
    if (!/^[A-Z]{1,3}$/.test(lettre)) return null
    const wrap = (groupe: string, amovible: boolean) => (amovible ? `(${groupe})` : groupe)

    if (aType === 'continu') {
      if (aMilImp < 1 || aMilPair < 1) return null
      return `${lettre} ${wrap(`${2 * aMilImp - 1}/1`, aAmovCentre)} ${wrap(`2/${2 * aMilPair}`, aAmovCentre)}`
    }
    if (aType === 'fosse') {
      if (aMilImp < 1 || aMilPair < 1) return null
      return `${lettre} (1/${2 * aMilImp - 1}) (2/${2 * aMilPair})`
    }
    if (aExtJ < 1 || aMilImp < 1 || aMilPair < 1 || aExtC < 1) return null
    const milImpHi = 2 * aMilImp - 1
    const milPairHi = 2 * aMilPair
    const extImpLo = milImpHi + 2
    const extPairLo = milPairHi + 2
    return [
      lettre,
      wrap(`${extImpLo + 2 * (aExtJ - 1)}/${extImpLo}`, aAmovExtJ),
      wrap(`${milImpHi}/1`, aAmovCentre),
      wrap(`2/${milPairHi}`, aAmovCentre),
      wrap(`${extPairLo}/${extPairLo + 2 * (aExtC - 1)}`, aAmovExtC),
    ].join(' ')
  }

  const lignePreview = construireLigne()

  const ajouterRang = () => {
    if (!lignePreview) return
    setNotation((n) => `${n.trimEnd()}\n${lignePreview}\n`)
    setALettre('') // la suggestion passe automatiquement à la lettre suivante
  }

  // Clic sur un chip → sélectionne la ligne correspondante dans l'éditeur.
  const allerALaLigne = (numero: number) => {
    const ta = textareaRef.current
    if (!ta) return
    const lignesTexte = ta.value.split('\n')
    const debut = lignesTexte.slice(0, numero - 1).join('\n').length + (numero > 1 ? 1 : 0)
    const fin = debut + (lignesTexte[numero - 1]?.length ?? 0)
    ta.focus()
    ta.setSelectionRange(debut, fin)
  }

  const enregistrer = () => {
    if (!pret || !resultat) return
    setSaveError(null)
    startSaving(async () => {
      const reponse = await enregistrerSalle({
        name: nom.trim() || 'Salle',
        config: JSON.parse(JSON.stringify(resultat.config)),
      })
      if (!reponse.ok) {
        setSaveError(reponse.error)
        return
      }
      router.push(
        '/admin/salles?ok=' +
          encodeURIComponent(`« ${nom.trim() || 'Salle'} » enregistrée — activez-la quand vous voulez.`),
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
        <h1>Créer une salle</h1>
        <p className={styles.intro}>
          Relevez la salle <strong>rang par rang, du fond vers la scène</strong> — avec
          l&apos;assistant ci-dessous, ou directement dans la notation de la fiche
          (<code>extérieur·impair milieu·impair milieu·pair extérieur·pair</code>, parenthèses =
          amovible). Survolez un rang pour le voir sur le plan.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.colonne}>
          <label className={styles.champ}>
            Nom de la salle
            <input type="text" value={nom} maxLength={100} onChange={(e) => setNom(e.target.value)} />
          </label>

          {/* ── Assistant : écrit la ligne de notation ─────────────────── */}
          <div className={styles.assistant}>
            <h2>Ajouter un rang</h2>
            <div className={styles.assistantLigne}>
              <label className={styles.mini}>
                Lettre
                <input
                  type="text"
                  value={aLettre}
                  placeholder={lettreParDefaut}
                  maxLength={3}
                  onChange={(e) => setALettre(e.target.value)}
                />
              </label>
              <label className={styles.mini}>
                Type
                <select value={aType} onChange={(e) => setAType(e.target.value as TypeRang)}>
                  <option value="blocs">3 blocs (allées)</option>
                  <option value="continu">Continu</option>
                  <option value="fosse">Central seul (fosse)</option>
                </select>
              </label>
            </div>
            <div className={styles.assistantLigne}>
              {aType === 'blocs' && (
                <label className={styles.mini}>
                  Ext. jardin
                  <input type="number" min={1} max={60} value={aExtJ} onChange={(e) => setAExtJ(Number(e.target.value))} />
                </label>
              )}
              <label className={styles.mini}>
                {aType === 'blocs' ? 'Milieu imp.' : 'Impairs'}
                <input type="number" min={1} max={99} value={aMilImp} onChange={(e) => setAMilImp(Number(e.target.value))} />
              </label>
              <label className={styles.mini}>
                {aType === 'blocs' ? 'Milieu pairs' : 'Pairs'}
                <input type="number" min={1} max={99} value={aMilPair} onChange={(e) => setAMilPair(Number(e.target.value))} />
              </label>
              {aType === 'blocs' && (
                <label className={styles.mini}>
                  Ext. cour
                  <input type="number" min={1} max={60} value={aExtC} onChange={(e) => setAExtC(Number(e.target.value))} />
                </label>
              )}
            </div>
            {aType !== 'fosse' && (
              <div className={styles.assistantLigne}>
                {aType === 'blocs' && (
                  <label className={styles.coche}>
                    <input type="checkbox" checked={aAmovExtJ} onChange={(e) => setAAmovExtJ(e.target.checked)} />
                    ext. jardin amovible
                  </label>
                )}
                <label className={styles.coche}>
                  <input type="checkbox" checked={aAmovCentre} onChange={(e) => setAAmovCentre(e.target.checked)} />
                  centre amovible
                </label>
                {aType === 'blocs' && (
                  <label className={styles.coche}>
                    <input type="checkbox" checked={aAmovExtC} onChange={(e) => setAAmovExtC(e.target.checked)} />
                    ext. cour amovible
                  </label>
                )}
              </div>
            )}
            <div className={styles.assistantPied}>
              <code className={styles.lignePreview}>{lignePreview ?? '—'}</code>
              <button type="button" onClick={ajouterRang} disabled={!lignePreview}>
                Ajouter
              </button>
            </div>
          </div>

          <label className={styles.champ}>
            Relevé des rangs
            <textarea
              ref={textareaRef}
              value={notation}
              rows={14}
              spellCheck={false}
              onChange={(e) => setNotation(e.target.value)}
            />
          </label>

          <button type="button" className={styles.ghost} onClick={chargerBergerac}>
            Partir de la salle de Bergerac (relevé réel)
          </button>

          <details className={styles.apparence}>
            <summary>Apparence du plan (ne change pas la numérotation)</summary>
            <div className={styles.params}>
              <label className={styles.mini}>
                Distance scène → 1er rang
                <input type="number" value={premierRayon} min={100} max={5000} onChange={(e) => setPremierRayon(Number(e.target.value))} />
              </label>
              <label className={styles.mini}>
                Espace entre rangs
                <input type="number" value={espacement} min={10} max={300} onChange={(e) => setEspacement(Number(e.target.value))} />
              </label>
              <label className={styles.mini}>
                Largeur d&apos;un siège (°)
                <input type="number" value={pitch} min={0.2} max={5} step={0.05} onChange={(e) => setPitch(Number(e.target.value))} />
              </label>
              <label className={styles.mini}>
                Largeur des allées (°)
                <input type="number" value={allee} min={0.5} max={15} step={0.5} onChange={(e) => setAllee(Number(e.target.value))} />
              </label>
            </div>
          </details>

          {saveError && (
            <p className={styles.erreur} role="alert">
              {saveError}
            </p>
          )}

          <button type="button" className={styles.telecharger} onClick={enregistrer} disabled={!pret || saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer dans la billetterie'}
          </button>
          <button type="button" className={styles.secondaire} onClick={telecharger} disabled={!pret}>
            Télécharger {slug}.json (sauvegarde fichier)
          </button>
          <p className={styles.aideCourte}>
            Une fois enregistrée : <strong>/admin/salles → Activer</strong> — le plan s&apos;applique
            immédiatement, sans reseed.
          </p>
        </section>

        {/* ── Aperçu + état rang par rang ───────────────────────────────── */}
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
          </p>

          <div className={styles.chips} onMouseLeave={() => setSurvol(null)}>
            {lignes.map((l) =>
              l.ok ? (
                <button
                  key={l.ligne}
                  type="button"
                  className={survol === l.row.label ? styles.chipActif : styles.chip}
                  onMouseEnter={() => setSurvol(l.row.label)}
                  onFocus={() => setSurvol(l.row.label)}
                  onClick={() => allerALaLigne(l.ligne)}
                  title={(() => {
                    const r = resumeRang(l.row)
                    return (
                      `Rang ${l.row.label} — ${r.total} places\nimpairs : ${r.impairs}\npairs : ${r.pairs}` +
                      (r.sauts.length ? `\nsauts : ${r.sauts.join(', ')} (n'existent pas)` : '') +
                      (r.amovibles ? `\n${r.amovibles} amovibles` : '')
                    )
                  })()}
                >
                  {l.row.label}
                  <span>{resumeRang(l.row).total}</span>
                  {resumeRang(l.row).sauts.length > 0 && <em title="sauts de numérotation">⤳</em>}
                </button>
              ) : (
                <button
                  key={l.ligne}
                  type="button"
                  className={styles.chipErreur}
                  onClick={() => allerALaLigne(l.ligne)}
                  title={l.error}
                >
                  ligne {l.ligne} ✗
                </button>
              ),
            )}
          </div>

          {erreurs.length > 0 && (
            <ul className={styles.listeErreurs}>
              {erreurs.map((l) => (
                <li key={l.ligne}>
                  <button type="button" onClick={() => allerALaLigne(l.ligne)}>
                    ligne {l.ligne}
                  </button>{' '}
                  {l.error}
                </li>
              ))}
            </ul>
          )}

          {resultat ? (
            <SeatMap
              seats={seatViews}
              highlightedIds={highlightedIds}
              caption={`Aperçu — ${nom || 'salle'} (géométrie indicative)`}
            />
          ) : (
            <p className={styles.apercuVide}>
              L&apos;aperçu s&apos;affichera dès qu&apos;un rang est valide — ajoutez-en un avec
              l&apos;assistant.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
