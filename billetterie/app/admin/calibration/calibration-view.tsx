'use client'

// Vue de calibration : un seul SVG superposant le scan de la fiche technique
// (public/plan-scan.png, réglable en opacité / échelle / décalage) et le plan
// généré depuis config/venue.ts. Les réglages de l'image sont persistés dans
// localStorage pour survivre aux hot reloads pendant la calibration.

import { useEffect, useMemo, useState } from 'react'

import type { GeneratedSeat } from '@/lib/venue/generate'

import styles from './calibration.module.css'

type Bounds = { minX: number; minY: number; width: number; height: number }

type Props = {
  seats: GeneratedSeat[]
  bounds: Bounds
  center: { x: number; y: number }
}

type OverlaySettings = {
  opacity: number
  scale: number
  dx: number
  dy: number
}

const STORAGE_KEY = 'calibration-overlay'

const DEFAULT_SETTINGS: OverlaySettings = {
  opacity: 0.5,
  scale: 1,
  dx: 0,
  dy: 0,
}

const SECTION_LABELS = { gauche: 'Gauche (jardin)', centre: 'Centre', droite: 'Droite (cour)' } as const

const SECTION_FILL = { gauche: '#aecbe3', centre: '#b7d6b0', droite: '#e8c9a0' } as const
const SECTION_STROKE = { gauche: '#5c87ad', centre: '#69985f', droite: '#b08a4f' } as const
const REMOVABLE_STROKE = '#c0564a'

function loadSettings(): OverlaySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<OverlaySettings>
    return {
      opacity: typeof parsed.opacity === 'number' ? parsed.opacity : DEFAULT_SETTINGS.opacity,
      scale: typeof parsed.scale === 'number' ? parsed.scale : DEFAULT_SETTINGS.scale,
      dx: typeof parsed.dx === 'number' ? parsed.dx : DEFAULT_SETTINGS.dx,
      dy: typeof parsed.dy === 'number' ? parsed.dy : DEFAULT_SETTINGS.dy,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export default function CalibrationView({ seats, bounds, center }: Props) {
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_SETTINGS)
  const [hydrated, setHydrated] = useState(false)
  const [scanMissing, setScanMissing] = useState(false)
  const [scanRetry, setScanRetry] = useState(0)

  // Chargement des réglages persistés (après hydratation, pour éviter tout
  // mismatch SSR/client).
  useEffect(() => {
    setSettings(loadSettings())
    setHydrated(true)
  }, [])

  // Persistance — uniquement une fois les réglages initiaux chargés.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // localStorage indisponible : on continue sans persistance.
    }
  }, [hydrated, settings])

  const set = (patch: Partial<OverlaySettings>) => setSettings((s) => ({ ...s, ...patch }))

  // ---- Géométrie dérivée (recalculée à chaque hot reload de la config) ----

  const derived = useMemo(() => {
    // Rayon de chaque rangée (distance au point de convergence) pour estimer
    // l'espacement entre rangées → rayon des sièges = 40 % de cet espacement.
    const radiusByRow = new Map<string, number>()
    for (const s of seats) {
      if (!radiusByRow.has(s.rowLabel)) {
        radiusByRow.set(s.rowLabel, Math.hypot(s.x - center.x, s.y - center.y))
      }
    }
    const radii = [...radiusByRow.values()].sort((a, b) => a - b)
    let rowSpacing = 85
    if (radii.length > 1) {
      rowSpacing = Math.min(...radii.slice(1).map((r, i) => r - radii[i]))
    }
    const seatRadius = rowSpacing * 0.4

    // Étiquettes de rangée aux deux extrémités (jardin / cour), placées sur
    // l'arc de la rangée, un peu au-delà du premier et du dernier siège.
    const rowLabels: { key: string; label: string; x: number; y: number }[] = []
    const byRow = new Map<string, GeneratedSeat[]>()
    for (const s of seats) {
      const list = byRow.get(s.rowLabel)
      if (list) list.push(s)
      else byRow.set(s.rowLabel, [s])
    }
    const labelGapDeg = 4
    for (const [label, rowSeats] of byRow) {
      const radius = radiusByRow.get(label)!
      const minAngle = Math.min(...rowSeats.map((s) => s.angle))
      const maxAngle = Math.max(...rowSeats.map((s) => s.angle))
      for (const angle of [minAngle - labelGapDeg, maxAngle + labelGapDeg]) {
        const rad = (angle * Math.PI) / 180
        rowLabels.push({
          key: `${label}-${angle < 0 ? 'jardin' : 'cour'}`,
          label,
          x: center.x + radius * Math.sin(rad),
          y: center.y - radius * Math.cos(rad),
        })
      }
    }

    // Repère SCÈNE : en bas du plan (y croissant vers la scène), centré sur
    // l'axe de la salle, entre le rang A et le point de convergence.
    const maxSeatY = Math.max(...seats.map((s) => s.y))
    const scene = {
      width: bounds.width * 0.42,
      height: rowSpacing * 1.3,
      x: center.x - (bounds.width * 0.42) / 2,
      y: maxSeatY + rowSpacing,
    }

    // viewBox : la boîte des sièges, étendue pour inclure la scène et la
    // croix du point de convergence.
    const minX = Math.min(bounds.minX, center.x - 120)
    const minY = Math.min(bounds.minY, center.y - 120)
    const maxX = Math.max(bounds.minX + bounds.width, center.x + 120)
    const maxY = Math.max(bounds.minY + bounds.height, center.y + 120, scene.y + scene.height + 40)
    const viewBox = { minX, minY, width: maxX - minX, height: maxY - minY }

    return { seatRadius, rowSpacing, rowLabels, scene, viewBox }
  }, [seats, bounds, center])

  const counters = useMemo(() => {
    const bySection = { gauche: 0, centre: 0, droite: 0 }
    let removable = 0
    for (const s of seats) {
      bySection[s.section] += 1
      if (s.removable) removable += 1
    }
    return { total: seats.length, bySection, removable }
  }, [seats])

  const { seatRadius, rowSpacing, rowLabels, scene, viewBox } = derived
  const fontSize = rowSpacing * 0.55
  const offsetRange = Math.round(Math.max(viewBox.width, viewBox.height))

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Calibration du plan de salle</h1>
        <p className={styles.hint}>
          Ajuste <code>config/venue.ts</code> — le plan se met à jour à chaud.
        </p>
      </header>

      {scanMissing && (
        <div className={styles.banner} role="status">
          <span>
            <code>public/plan-scan.png</code> absent — dépose le scan de la fiche technique.
          </span>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={() => {
              setScanMissing(false)
              setScanRetry((n) => n + 1)
            }}
          >
            Réessayer
          </button>
        </div>
      )}

      <div className={styles.layout}>
        <aside className={styles.panel}>
          <section className={styles.panelSection}>
            <h2 className={styles.panelTitle}>Sièges</h2>
            <dl className={styles.counters}>
              <div className={styles.counter}>
                <dt>Total</dt>
                <dd>{counters.total}</dd>
              </div>
              {(['gauche', 'centre', 'droite'] as const).map((section) => (
                <div key={section} className={styles.counter}>
                  <dt>
                    <span className={styles.swatch} style={{ background: SECTION_FILL[section] }} />
                    {SECTION_LABELS[section]}
                  </dt>
                  <dd>{counters.bySection[section]}</dd>
                </div>
              ))}
              <div className={styles.counter}>
                <dt>
                  <span className={`${styles.swatch} ${styles.swatchRemovable}`} />
                  Amovibles
                </dt>
                <dd>{counters.removable}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.panelSection}>
            <h2 className={styles.panelTitle}>Scan superposé</h2>

            <div className={styles.control}>
              <label htmlFor="cal-opacity">Opacité</label>
              <div className={styles.controlInputs}>
                <input
                  id="cal-opacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.opacity}
                  onChange={(e) => set({ opacity: Number(e.target.value) })}
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.opacity}
                  onChange={(e) => set({ opacity: Number(e.target.value) })}
                  aria-label="Opacité (valeur précise)"
                />
              </div>
            </div>

            <div className={styles.control}>
              <label htmlFor="cal-scale">Échelle</label>
              <div className={styles.controlInputs}>
                <input
                  id="cal-scale"
                  type="range"
                  min={0.1}
                  max={5}
                  step={0.005}
                  value={settings.scale}
                  onChange={(e) => set({ scale: Number(e.target.value) })}
                />
                <input
                  type="number"
                  min={0.1}
                  max={5}
                  step={0.001}
                  value={settings.scale}
                  onChange={(e) => set({ scale: Number(e.target.value) })}
                  aria-label="Échelle (valeur précise)"
                />
              </div>
            </div>

            <div className={styles.control}>
              <label htmlFor="cal-dx">Décalage X</label>
              <div className={styles.controlInputs}>
                <input
                  id="cal-dx"
                  type="range"
                  min={-offsetRange}
                  max={offsetRange}
                  step={1}
                  value={settings.dx}
                  onChange={(e) => set({ dx: Number(e.target.value) })}
                />
                <input
                  type="number"
                  step={1}
                  value={settings.dx}
                  onChange={(e) => set({ dx: Number(e.target.value) })}
                  aria-label="Décalage X (valeur précise)"
                />
              </div>
            </div>

            <div className={styles.control}>
              <label htmlFor="cal-dy">Décalage Y</label>
              <div className={styles.controlInputs}>
                <input
                  id="cal-dy"
                  type="range"
                  min={-offsetRange}
                  max={offsetRange}
                  step={1}
                  value={settings.dy}
                  onChange={(e) => set({ dy: Number(e.target.value) })}
                />
                <input
                  type="number"
                  step={1}
                  value={settings.dy}
                  onChange={(e) => set({ dy: Number(e.target.value) })}
                  aria-label="Décalage Y (valeur précise)"
                />
              </div>
            </div>

            <button type="button" className={styles.reset} onClick={() => setSettings(DEFAULT_SETTINGS)}>
              Réinitialiser
            </button>
          </section>
        </aside>

        <main className={styles.planArea}>
          <svg
            className={styles.plan}
            viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
            role="img"
            aria-label="Plan de salle généré, superposé au scan de la fiche technique"
          >
            {/* Scan de la fiche technique, sous les sièges. */}
            {!scanMissing && (
              <g
                transform={`translate(${viewBox.minX + settings.dx} ${viewBox.minY + settings.dy}) scale(${settings.scale})`}
                opacity={settings.opacity}
              >
                <image
                  key={scanRetry}
                  href={`/plan-scan.png${scanRetry > 0 ? `?r=${scanRetry}` : ''}`}
                  x={0}
                  y={0}
                  width={viewBox.width}
                  height={viewBox.height}
                  preserveAspectRatio="xMinYMin meet"
                  onError={() => setScanMissing(true)}
                />
              </g>
            )}

            {/* Repère SCÈNE. */}
            <g>
              <rect
                x={scene.x}
                y={scene.y}
                width={scene.width}
                height={scene.height}
                rx={8}
                fill="#3a3f46"
                opacity={0.92}
              />
              <text
                x={center.x}
                y={scene.y + scene.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ffffff"
                fontSize={fontSize}
                letterSpacing={fontSize * 0.3}
              >
                SCÈNE
              </text>
            </g>

            {/* Croix au point de convergence des arcs. */}
            <g stroke="#c0564a" strokeWidth={4}>
              <line x1={center.x - 40} y1={center.y} x2={center.x + 40} y2={center.y} />
              <line x1={center.x} y1={center.y - 40} x2={center.x} y2={center.y + 40} />
            </g>

            {/* Étiquettes de rangée, côtés jardin et cour. */}
            {rowLabels.map((l) => (
              <text
                key={l.key}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fill="#555b63"
                fontWeight={600}
              >
                {l.label}
              </text>
            ))}

            {/* Sièges. */}
            {seats.map((s) => (
              <circle
                key={s.id}
                cx={s.x}
                cy={s.y}
                r={seatRadius}
                fill={SECTION_FILL[s.section]}
                stroke={s.removable ? REMOVABLE_STROKE : SECTION_STROKE[s.section]}
                strokeWidth={s.removable ? 4 : 2}
                strokeDasharray={s.removable ? '8 6' : undefined}
              >
                <title>
                  {`Rang ${s.rowLabel} — place ${s.number} · section ${s.section} · indexInRow ${s.indexInRow} · angle ${Math.round(s.angle)}° · score ${s.score}`}
                </title>
              </circle>
            ))}
          </svg>
        </main>
      </div>
    </div>
  )
}
