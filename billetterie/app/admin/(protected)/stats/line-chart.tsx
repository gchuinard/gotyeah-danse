'use client'

// Courbe cumulative INTERACTIVE : quadrillage, axes, info-bulle au survol.
// onMouseMove sur le SVG entier → point le plus proche calculé en JS.
// Bulle toujours montée (opacity 0→1) : pas de flash au changement de point.
//
// ⚠️ Composant CLIENT : ses props doivent être SÉRIALISABLES. Ne JAMAIS lui
// passer de fonction (ex. un `format` callback) depuis le composant serveur
// `page.tsx` → Next.js lève « Functions cannot be passed to Client Components ».
// Le formatage se fait ici, à partir d'une simple chaîne `unit`.

import { type MouseEvent, useState } from 'react'

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
  unit,
}: {
  points: { label: string; value: number }[]
  unit?: string
}) {
  // `idx` = point décrit par la bulle (dernier survolé) ; `visible` = bulle
  // affichée. Séparer les deux laisse la bulle garder son contenu pendant le
  // fondu de sortie (on baisse `visible`, `idx` ne bouge pas). Les deux ne sont
  // mis à jour QUE dans les handlers — jamais pendant le render.
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(false)

  if (points.length === 0) return null

  const fmt = (v: number) => (unit ? `${v} ${unit}` : String(v))

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

  function handleMouseMove(e: MouseEvent<SVGSVGElement>) {
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
    setIdx(nearest)
    setVisible(true)
  }

  const dernier = points[n - 1]
  // Le point décrit par la bulle, borné au cas où `points` a rétréci.
  const shown = Math.min(idx, n - 1)
  // Clamp horizontal pour que la bulle reste dans la carte.
  const tipLeftPct = Math.max(5, Math.min(95, (x(shown) / W) * 100))
  const tipTopPct = (y(points[shown].value) / H) * 100

  return (
    <div className={styles.lineChart}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.lineSvg}
        role="img"
        aria-label={`Cumul ${fmt(dernier.value)} au ${dernier.label}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setVisible(false)}
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
        {visible && (
          <line x1={x(shown)} y1={MT} x2={x(shown)} y2={MT + plotH} className={styles.lineHover} />
        )}

        {/* Points (le survolé grossit) */}
        {points.map((p, i) => (
          <circle
            key={`pt${i}`}
            cx={x(i)}
            cy={y(p.value)}
            r={visible && shown === i ? 4.5 : 2.6}
            className={styles.linePoint}
          />
        ))}

        {/* Zone de capture souris — toute la surface du graphe */}
        <rect x={ML} y={MT} width={plotW} height={plotH} fill="transparent" style={{ cursor: 'crosshair' }} />
      </svg>

      {/* Bulle toujours montée : opacity CSS → pas de flash au changement de point */}
      <div
        className={styles.lineTip}
        data-visible={visible}
        style={{ left: `${tipLeftPct}%`, top: `${tipTopPct}%` }}
        aria-hidden={!visible}
      >
        <strong>{fmt(points[shown].value)}</strong>
        <span>{points[shown].label}</span>
      </div>
    </div>
  )
}
