'use client'

// Plan de salle SVG réutilisable (vue plan + écran de placement).
//
// Composant PUR : il reçoit les SeatView et des listes d'ids, ne connaît ni
// Prisma ni le polling. Les coordonnées x/y sont en pixels du scan de la
// fiche technique (~1850×2600, voir lib/venue/generate.ts) — le SVG scale
// tout seul via viewBox, pas de zoom/pan en V1.
//
// La scène est en BAS du plan : le point de convergence des arcs (y ≈ 2520)
// est sous tous les sièges, le rang A est le plus bas.

import { useMemo } from 'react'

import type { SeatView } from '@/lib/admin/seat-map'

import styles from './seat-map.module.css'

const SEAT_R = 9 // rayon en px du repère scan
const MARGIN = 40

const SECTION_LABELS: Record<string, string> = {
  gauche: 'Gauche',
  centre: 'Centre',
  droite: 'Droite',
}

export const REASON_LABELS: Record<string, string> = {
  console_son: 'console son',
  fosse_avant_scene: 'fosse avant-scène',
  amovibles_non_poses: 'amovibles non posés',
}

function sectionLabel(id: string): string {
  return SECTION_LABELS[id] ?? id
}

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason
}

function seatTitle(seat: SeatView): string {
  let title = `Rang ${seat.rowLabel} place ${seat.number} — ${sectionLabel(seat.section)}`
  if (seat.status === 'occupe' && seat.occupant) title += ` — ${seat.occupant}`
  if (seat.status === 'bloque') title += ` — bloqué${seat.overrideReason ? ` (${reasonLabel(seat.overrideReason)})` : ''}`
  return title
}

export type SeatMapProps = {
  seats: SeatView[]
  selectedIds?: string[]
  highlightedIds?: string[]
  // Places actuelles d'un booking en mode déplacement — style distinct, cliquables.
  currentIds?: string[]
  onSeatClick?: (seat: SeatView) => void
  // Mode « gérer les blocages » : autorise aussi le clic sur les sièges bloqués
  // (pour les débloquer). Par défaut, seuls libre/current sont cliquables.
  clickBlocked?: boolean
  caption?: string
}

export default function SeatMap({
  seats,
  selectedIds,
  highlightedIds,
  currentIds,
  onSeatClick,
  clickBlocked = false,
  caption,
}: SeatMapProps) {
  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds])
  const highlighted = useMemo(() => new Set(highlightedIds ?? []), [highlightedIds])
  const current = useMemo(() => new Set(currentIds ?? []), [currentIds])

  const geometry = useMemo(() => {
    const xs = seats.map((s) => s.x)
    const ys = seats.map((s) => s.y)
    const minX = Math.min(...xs) - MARGIN
    const maxX = Math.max(...xs) + MARGIN
    const minY = Math.min(...ys) - MARGIN
    const maxSeatY = Math.max(...ys)

    // Repère SCÈNE en bas du plan, centré sur l'axe de la salle.
    const sceneWidth = (maxX - minX) * 0.42
    const scene = {
      x: (minX + maxX) / 2 - sceneWidth / 2,
      y: maxSeatY + 55,
      width: sceneWidth,
      height: 100,
    }
    const maxY = scene.y + scene.height + MARGIN

    return { scene, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` }
  }, [seats])

  const clickable = (seat: SeatView): boolean => {
    if (!onSeatClick) return false
    if (seat.status === 'libre') return true
    if (current.has(seat.id)) return true
    if (clickBlocked && seat.status === 'bloque') return true
    return false
  }

  return (
    <figure className={styles.figure}>
      <svg
        className={styles.svg}
        viewBox={geometry.viewBox}
        role="img"
        aria-label={caption ?? 'Plan de salle'}
      >
        {seats.map((seat) => {
          const isClickable = clickable(seat)
          const classNames = [
            styles.seat,
            seat.status === 'occupe' ? styles.occupe : seat.status === 'bloque' ? styles.bloque : styles.libre,
            seat.removable && seat.status !== 'bloque' ? styles.removable : '',
            current.has(seat.id) ? styles.current : '',
            highlighted.has(seat.id) ? styles.highlighted : '',
            selected.has(seat.id) ? styles.selected : '',
            isClickable ? styles.clickable : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <g key={seat.id} onClick={isClickable ? () => onSeatClick!(seat) : undefined}>
              <circle className={classNames} cx={seat.x} cy={seat.y} r={SEAT_R}>
                <title>{seatTitle(seat)}</title>
              </circle>
              {seat.status === 'bloque' && (
                <path
                  className={styles.cross}
                  d={`M ${seat.x - 4.5} ${seat.y - 4.5} l 9 9 M ${seat.x + 4.5} ${seat.y - 4.5} l -9 9`}
                />
              )}
            </g>
          )
        })}

        <g>
          <rect
            className={styles.scene}
            x={geometry.scene.x}
            y={geometry.scene.y}
            width={geometry.scene.width}
            height={geometry.scene.height}
            rx={10}
          />
          <text
            className={styles.sceneLabel}
            x={geometry.scene.x + geometry.scene.width / 2}
            y={geometry.scene.y + geometry.scene.height / 2}
          >
            SCÈNE
          </text>
        </g>
      </svg>

      <figcaption className={styles.legend}>
        {caption && <span className={styles.caption}>{caption}</span>}
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotLibre}`} /> libre
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotOccupe}`} /> occupé
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotBloque}`} /> bloqué
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotRemovable}`} /> amovible
        </span>
        {selectedIds !== undefined && (
          <span className={styles.legendItem}>
            <span className={`${styles.dot} ${styles.dotSelected}`} /> sélection
          </span>
        )}
        {highlightedIds !== undefined && (
          <span className={styles.legendItem}>
            <span className={`${styles.dot} ${styles.dotHighlighted}`} /> suggestion
          </span>
        )}
        {currentIds !== undefined && currentIds.length > 0 && (
          <span className={styles.legendItem}>
            <span className={`${styles.dot} ${styles.dotCurrent}`} /> places actuelles
          </span>
        )}
      </figcaption>
    </figure>
  )
}
