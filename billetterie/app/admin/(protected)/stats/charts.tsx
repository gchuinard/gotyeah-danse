// Graphes légers de /admin/stats — SVG/CSS inline, ZÉRO dépendance (cohérent
// avec l'esprit du projet). Composants SERVEUR purs : ils ne reçoivent que des
// données déjà calculées et n'ont aucune interactivité.
//
// La courbe INTERACTIVE (info-bulle au survol) vit à part, dans `line-chart.tsx`
// ('use client') — elle ne peut PAS recevoir de prop fonction depuis le serveur.

import type { CSSProperties } from 'react'

import styles from './charts.module.css'

// Jauge de remplissage (barre de progression value/max).
export function Jauge({
  value,
  max,
  caption,
}: {
  value: number
  max: number
  caption?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className={styles.jauge}>
      <div className={styles.jaugeTrack} role="img" aria-label={`${value} sur ${max} (${pct} %)`}>
        <div className={styles.jaugeFill} style={{ width: `${pct}%` }} />
        <span className={styles.jaugePct}>{pct} %</span>
      </div>
      {caption && <p className={styles.chartCaption}>{caption}</p>}
    </div>
  )
}

export type Barre = { label: string; value: number; hint?: string; ton?: 'a' | 'b' | 'c' }

// Barres horizontales, normalisées sur la plus grande valeur. `labelWidth`
// règle la largeur de la colonne des libellés (défaut 5.5rem) — utile pour des
// noms longs (ex. boissons de la buvette).
export function BarChart({
  data,
  format,
  labelWidth,
}: {
  data: Barre[]
  format: (v: number) => string
  labelWidth?: string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div
      className={styles.barChart}
      role="img"
      aria-label={data.map((d) => `${d.label} : ${format(d.value)}`).join(', ')}
      style={labelWidth ? ({ '--bar-label-w': labelWidth } as CSSProperties) : undefined}
    >
      {data.map((d) => (
        <div key={d.label} className={styles.barRow}>
          <span className={styles.barLabel}>{d.label}</span>
          <span className={styles.barTrack}>
            <span
              className={`${styles.barFill} ${d.ton ? styles[`ton_${d.ton}`] : ''}`}
              style={{ width: `${Math.round((d.value / max) * 100)}%` }}
            />
          </span>
          <span className={styles.barValue}>
            {format(d.value)}
            {d.hint ? <small className={styles.barHint}> · {d.hint}</small> : null}
          </span>
        </div>
      ))}
    </div>
  )
}
