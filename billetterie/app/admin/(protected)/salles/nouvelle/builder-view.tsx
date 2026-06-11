'use client'

// Créateur de salle — éditeur de la notation place.md avec aperçu live.
// Le relevé se fait rang par rang (du FOND vers la SCÈNE) :
//   <extImpair> <milieuImpair> <milieuPair> <extPair>   ex. B 37/19 17/1 2/18 20/38
//   ( … ) = bloc amovible · rang continu : A 45/1 2/44
// Les sauts de numérotation réels (ex. pairs 12 puis 16) sont capturés.

import { useMemo, useState } from 'react'

import SeatMap from '@/components/admin/seat-map'
import type { SeatView } from '@/lib/admin/seat-map'
import { BUILDER_DEFAULTS, buildVenueConfig } from '@/lib/venue/build'
import { generateSeats } from '@/lib/venue/generate'
import { parsePlaceNotation } from '@/lib/venue/place-notation'
import { parseVenueConfig } from '@/lib/venue/schema'

import styles from './salles.module.css'

const EXEMPLE = `# Une ligne par rang, du FOND vers la SCÈNE.
# <ext impair> <milieu impair> <milieu pair> <ext pair> — (…) = amovible
A 25/15 13/1 2/14 16/26
B 25/15 13/1 2/14 16/26
C 23/13 11/1 2/12 14/24
D (1/13) (2/14)
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

export default function BuilderView() {
  const [nom, setNom] = useState('Ma salle')
  const [notation, setNotation] = useState(EXEMPLE)
  const [premierRayon, setPremierRayon] = useState(BUILDER_DEFAULTS.premierRayon)
  const [espacement, setEspacement] = useState(BUILDER_DEFAULTS.espacement)
  const [pitch, setPitch] = useState(BUILDER_DEFAULTS.pitch)
  const [allee, setAllee] = useState(BUILDER_DEFAULTS.allee)

  const resultat = useMemo(() => {
    try {
      const rows = parsePlaceNotation(notation)
      const config = buildVenueConfig(
        { name: nom.trim() || 'Salle', premierRayon, espacement, pitch, allee },
        rows,
      )
      const seats = generateSeats(config)
      return { ok: true as const, config, seats }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  }, [nom, notation, premierRayon, espacement, pitch, allee])

  const seatViews: SeatView[] = useMemo(() => {
    if (!resultat.ok) return []
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

  const telecharger = () => {
    if (!resultat.ok) return
    // Filet de sécurité : le fichier téléchargé est exactement ce que le
    // loader (VENUE_ID) acceptera.
    const config = parseVenueConfig(JSON.parse(JSON.stringify(resultat.config)), 'builder')
    const slug = slugifier(nom)
    const blob = new Blob([JSON.stringify(config, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const slug = slugifier(nom)
  const amovibles = resultat.ok ? resultat.seats.filter((s) => s.removable).length : 0

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Créer une salle</h1>
        <p className={styles.intro}>
          Relevez la salle rang par rang (du fond vers la scène) dans la notation de la fiche :
          <code> extérieur·impair milieu·impair milieu·pair extérieur·pair</code>, parenthèses =
          amovible. Les sauts de numérotation sont conservés.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.colonne}>
          <label className={styles.champ}>
            Nom de la salle
            <input type="text" value={nom} maxLength={100} onChange={(e) => setNom(e.target.value)} />
          </label>

          <div className={styles.params}>
            <label className={styles.champ}>
              1er rayon (px)
              <input type="number" value={premierRayon} min={100} max={5000} onChange={(e) => setPremierRayon(Number(e.target.value))} />
            </label>
            <label className={styles.champ}>
              Espacement rangs
              <input type="number" value={espacement} min={10} max={300} onChange={(e) => setEspacement(Number(e.target.value))} />
            </label>
            <label className={styles.champ}>
              Largeur siège (°)
              <input type="number" value={pitch} min={0.2} max={5} step={0.05} onChange={(e) => setPitch(Number(e.target.value))} />
            </label>
            <label className={styles.champ}>
              Largeur allée (°)
              <input type="number" value={allee} min={0.5} max={15} step={0.5} onChange={(e) => setAllee(Number(e.target.value))} />
            </label>
          </div>

          <label className={styles.champ}>
            Relevé des rangs (notation place.md)
            <textarea
              value={notation}
              rows={16}
              spellCheck={false}
              onChange={(e) => setNotation(e.target.value)}
            />
          </label>

          {resultat.ok ? (
            <p className={styles.resume} role="status">
              ✅ {resultat.config.rows.length} rangs · {resultat.seats.length} places
              {amovibles > 0 ? ` (dont ${amovibles} amovibles)` : ''}
            </p>
          ) : (
            <p className={styles.erreur} role="alert">
              {resultat.error}
            </p>
          )}

          <button type="button" className={styles.telecharger} onClick={telecharger} disabled={!resultat.ok}>
            Télécharger {slug}.json
          </button>

          <div className={styles.aide}>
            <h2>Activer cette salle</h2>
            <ol>
              <li>
                Déposer le fichier dans <code>config/venues/{slug}.json</code> (le commiter).
              </li>
              <li>
                Dans le <code>.env</code> : <code>VENUE_ID={slug}</code>.
              </li>
              <li>
                Rebuild (prod : <code>docker compose up -d --build</code>) puis{' '}
                <code>pnpm db:seed</code> — AVANT toute vente.
              </li>
            </ol>
          </div>
        </section>

        <section className={styles.apercu}>
          {resultat.ok ? (
            <SeatMap seats={seatViews} caption={`Aperçu — ${nom || 'salle'} (géométrie régulière indicative)`} />
          ) : (
            <p className={styles.apercuVide}>L&apos;aperçu s&apos;affichera quand le relevé sera valide.</p>
          )}
        </section>
      </div>
    </main>
  )
}
