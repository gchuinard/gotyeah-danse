'use client'

// Courbe cumulative INTERACTIVE : quadrillage, axes, info-bulle au survol.
// onMouseMove sur le SVG entier → point le plus proche calculé en JS.
// Bulle toujours montée (opacity 0→1) : pas de flash au changement de point.

import { useRef, useState } from 'react'

import styles from './charts.module.css'

const W = 600
const H = 240
const ML = 46
const MR = 14
const MT = 12
const MB = 30
const plotW = W - ML - MR
const plotH = H - MT - MB

export function LineChart({
  points,
  format,
}: {
  points: { label: string; value: number }[]
  format: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const lastHover = useRef<number>(0)
  if (hover !== null) lastHover.current = hover

  if (points.length === 0) return null

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

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    let nearest = 0
    let minD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - svgX)
      if (d < minD) {
        minD = d
        nearest = i
      }
    }
    setHover(nearest)
  }

  const dernier = points[n - 1]
  const tipIdx = hover ?? lastHover.current
  // Clamp horizontal pour rester dans la carte
  const tipLeftPct = Math.max(5, Math.min(95, (x(tipIdx) / W) * 100))
  const tipTopPct = (y(points[tipIdx].value) / H) * 100

  return (
    <div className={styles.lineChart}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.lineSvg}
        role="img"
        aria-label={`Cumul ${format(dernier.value)} au ${dernier.label}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Quadrillage horizontal + valeurs à gauche */}
        {yTicks.map((t, k) => (
          <g key={`y${k}`}>
            <line x1={ML} y1={t.yy} x2={W - MR} y2={t.yy} className={styles.lineGrid} />
            <text x={ML - 7} y={t.yy} className={styles.lineYLabel} textAnchor="end" dominantBaseline="middle">
              {Math.round(t.v)}
            </text>
          </g>
        ))}
        {/* Quadrillage vertical + dates en bas */}
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

        {/* Repère vertical du point survolé */}
        {hover !== null && (
          <line x1={x(hover)} y1={MT} x2={x(hover)} y2={MT + plotH} className={styles.lineHover} />
        )}

        {/* Points (le survolé grossit) */}
        {points.map((p, i) => (
          <circle
            key={`pt${i}`}
            cx={x(i)}
            cy={y(p.value)}
            r={hover === i ? 4.5 : 2.6}
            className={styles.linePoint}
          />
        ))}

        {/* Zone de capture souris — toute la surface du graphe */}
        <rect x={ML} y={MT} width={plotW} height={plotH} fill="transparent" style={{ cursor: 'crosshair' }} />
      </svg>

      {/* Bulle toujours montée : opacity CSS → pas de flash au changement de point */}
      <div
        className={styles.lineTip}
        data-visible={hover !== null}
        style={{ left: `${tipLeftPct}%`, top: `${tipTopPct}%` }}
        aria-hidden={hover === null}
      >
        <strong>{format(points[tipIdx].value)}</strong>
        <span>{points[tipIdx].label}</span>
      </div>
    </div>
  )
}
