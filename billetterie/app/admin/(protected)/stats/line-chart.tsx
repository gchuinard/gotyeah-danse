'use client'

// Courbe cumulative INTERACTIVE (montée des demandes dans le temps) : quadrillage,
// axes (valeurs à gauche, dates en bas) et info-bulle au survol. Des bandes de
// survol pleine hauteur (une par point) rendent TOUTE la colonne survolable —
// pas besoin de viser le point exact. Composant client (état de survol).

import { useState } from 'react'

import styles from './charts.module.css'

export function LineChart({
  points,
  format,
}: {
  points: { label: string; value: number }[]
  format: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
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

  const TICKS = 4
  const yTicks = Array.from({ length: TICKS + 1 }, (_, k) => ({
    v: (maxV * k) / TICKS,
    yy: y((maxV * k) / TICKS),
  }))

  const pasX = Math.max(1, Math.ceil(n / 6))
  const xIdx: number[] = []
  for (let i = 0; i < n; i += pasX) xIdx.push(i)
  if (xIdx[xIdx.length - 1] !== n - 1) xIdx.push(n - 1)

  const trace = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(' ')
  const aire = `${trace} L ${x(n - 1).toFixed(1)} ${(MT + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(MT + plotH).toFixed(1)} Z`

  // Bande de survol d'un point : du milieu vers le point précédent au milieu vers
  // le suivant (toute la colonne, sur la hauteur du graphe).
  const bande = (i: number) => {
    const gauche = i === 0 ? ML : (x(i - 1) + x(i)) / 2
    const droite = i === n - 1 ? W - MR : (x(i) + x(i + 1)) / 2
    return { x: gauche, w: Math.max(0.1, droite - gauche) }
  }

  const dernier = points[n - 1]
  return (
    <div className={styles.lineChart}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.lineSvg}
        role="img"
        aria-label={`Cumul ${format(dernier.value)} au ${dernier.label}`}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t, k) => (
          <g key={`y${k}`}>
            <line x1={ML} y1={t.yy} x2={W - MR} y2={t.yy} className={styles.lineGrid} />
            <text x={ML - 7} y={t.yy} className={styles.lineYLabel} textAnchor="end" dominantBaseline="middle">
              {Math.round(t.v)}
            </text>
          </g>
        ))}
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

        {/* Repère vertical du point survolé. */}
        {hover !== null && (
          <line x1={x(hover)} y1={MT} x2={x(hover)} y2={MT + plotH} className={styles.lineHover} />
        )}

        {/* Points (le survolé grossit). */}
        {points.map((p, i) => (
          <circle
            key={`pt${i}`}
            cx={x(i)}
            cy={y(p.value)}
            r={hover === i ? 4.5 : 2.6}
            className={styles.linePoint}
          />
        ))}

        {/* Bandes de survol pleine hauteur (transparentes), au-dessus du reste. */}
        {points.map((p, i) => {
          const b = bande(i)
          return (
            <rect
              key={`hit${i}`}
              x={b.x}
              y={MT}
              width={b.w}
              height={plotH}
              className={styles.lineBande}
              onMouseEnter={() => setHover(i)}
            />
          )
        })}
      </svg>

      {hover !== null && (
        <div
          className={styles.lineTip}
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(points[hover].value) / H) * 100}%` }}
        >
          <strong>{format(points[hover].value)}</strong>
          <span>{points[hover].label}</span>
        </div>
      )}
    </div>
  )
}
