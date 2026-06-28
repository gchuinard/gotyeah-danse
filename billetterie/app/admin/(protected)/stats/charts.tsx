// Graphes légers de /admin/stats — SVG/CSS inline, ZÉRO dépendance (cohérent
// avec l'esprit du projet). Composants SERVEUR purs : ils ne reçoivent que des
// données déjà calculées et n'ont aucune interactivité.

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

// Courbe cumulative (montée des demandes dans le temps) avec quadrillage,
// valeurs en ordonnée (gauche) et dates réparties en abscisse (bas).
export function LineChart({
  points,
  format,
}: {
  points: { label: string; value: number }[]
  format: (v: number) => string
}) {
  if (points.length === 0) return null
  const W = 600
  const H = 240
  const ML = 46 // marge gauche (labels valeurs)
  const MR = 14
  const MT = 12
  const MB = 30 // marge basse (labels dates)
  const plotW = W - ML - MR
  const plotH = H - MT - MB
  const maxV = Math.max(1, ...points.map((p) => p.value))
  const n = points.length
  const x = (i: number) => ML + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1))
  const y = (v: number) => MT + plotH - (v / maxV) * plotH

  // Graduations Y : 4 intervalles (0 → maxV).
  const TICKS = 4
  const yTicks = Array.from({ length: TICKS + 1 }, (_, k) => ({
    v: (maxV * k) / TICKS,
    yy: y((maxV * k) / TICKS),
  }))

  // Graduations X : au plus 6 dates, réparties uniformément (la dernière incluse).
  const pasX = Math.max(1, Math.ceil(n / 6))
  const xIdx: number[] = []
  for (let i = 0; i < n; i += pasX) xIdx.push(i)
  if (xIdx[xIdx.length - 1] !== n - 1) xIdx.push(n - 1)

  const trace = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(' ')
  const aire = `${trace} L ${x(n - 1).toFixed(1)} ${(MT + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(MT + plotH).toFixed(1)} Z`
  const dernier = points[n - 1]
  return (
    <div className={styles.lineChart}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.lineSvg}
        role="img"
        aria-label={`Cumul ${format(dernier.value)} au ${dernier.label}`}
      >
        {/* Quadrillage horizontal + valeurs à gauche. */}
        {yTicks.map((t, k) => (
          <g key={`y${k}`}>
            <line x1={ML} y1={t.yy} x2={W - MR} y2={t.yy} className={styles.lineGrid} />
            <text x={ML - 7} y={t.yy} className={styles.lineYLabel} textAnchor="end" dominantBaseline="middle">
              {Math.round(t.v)}
            </text>
          </g>
        ))}
        {/* Quadrillage vertical + dates en bas. */}
        {xIdx.map((i) => (
          <g key={`x${i}`}>
            <line x1={x(i)} y1={MT} x2={x(i)} y2={MT + plotH} className={styles.lineGridV} />
            <text x={x(i)} y={MT + plotH + 18} className={styles.lineXLabel} textAnchor="middle">
              {points[i].label}
            </text>
          </g>
        ))}
        <path d={aire} className={styles.lineArea} />
        <path d={trace} className={styles.linePath} fill="none" />
      </svg>
    </div>
  )
}
