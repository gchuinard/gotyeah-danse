'use client'

// Plan de salle SVG réutilisable (vue plan + écran de placement + builder).
//
// Composant PUR : il reçoit les SeatView et des listes d'ids, ne connaît ni
// Prisma ni le polling. Les coordonnées x/y sont en pixels du repère de la
// config (scan de la fiche pour Bergerac) — le SVG scale via viewBox.
//
// Zoom & déplacement : molette (ancrée sur le curseur) + glisser, et boutons
// + / − / ⟲. Un glisser ne déclenche jamais le clic d'un siège (seuil 5 px).
//
// La scène est en BAS du plan : le point de convergence des arcs est sous
// tous les sièges. Les lettres de rang sont affichées aux deux bouts de
// chaque rangée.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { SeatView } from '@/lib/admin/seat-map'

import styles from './seat-map.module.css'

const SEAT_R = 9 // rayon en px du repère scan
const MARGIN = 70 // marge du viewBox — laisse la place aux lettres de rang
const ZOOM_MAX = 8 // zoom maximal (base/8)
const DRAG_SEUIL_PX = 5 // en-deçà : clic ; au-delà : déplacement

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
  if (seat.removable) title += ' — amovible'
  if (seat.status === 'occupe' && seat.occupant) title += ` — ${seat.occupant}`
  if (seat.status === 'bloque') title += ` — bloqué${seat.overrideReason ? ` (${reasonLabel(seat.overrideReason)})` : ''}`
  return title
}

type Box = { x: number; y: number; w: number; h: number }

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
  // Mode « gérer les amovibles » : TOUS les sièges sont cliquables.
  clickAll?: boolean
  caption?: string
}

export default function SeatMap({
  seats,
  selectedIds,
  highlightedIds,
  currentIds,
  onSeatClick,
  clickBlocked = false,
  clickAll = false,
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

    // Lettres de rang : aux deux bouts de chaque rangée physique.
    const parRang = new Map<string, SeatView[]>()
    for (const s of seats) {
      const list = parRang.get(s.rowLabel) ?? []
      list.push(s)
      parRang.set(s.rowLabel, list)
    }
    const rowLabels = [...parRang.entries()].flatMap(([label, list]) => {
      const gauche = list.reduce((a, b) => (b.x < a.x ? b : a))
      const droite = list.reduce((a, b) => (b.x > a.x ? b : a))
      return [
        { key: `${label}-g`, label, x: gauche.x - 32, y: gauche.y, anchor: 'end' as const },
        { key: `${label}-d`, label, x: droite.x + 32, y: droite.y, anchor: 'start' as const },
      ]
    })

    const base: Box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    return { scene, base, rowLabels }
  }, [seats])

  // Zoom/pan : le viewBox courant est un sous-rectangle de la base.
  const [view, setView] = useState<Box | null>(null) // null = vue complète
  const box = view ?? geometry.base

  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const clampView = (v: Box): Box => {
    const { base } = geometry
    const w = Math.min(Math.max(v.w, base.w / ZOOM_MAX), base.w)
    const h = (w / base.w) * base.h
    const x = Math.min(Math.max(v.x, base.x), base.x + base.w - w)
    const y = Math.min(Math.max(v.y, base.y), base.y + base.h - h)
    return { x, y, w, h }
  }

  const zoomer = (facteur: number, ancre?: { px: number; py: number }) => {
    const a = ancre ?? { px: 0.5, py: 0.5 }
    setView((prev) => {
      const v = prev ?? geometry.base
      const w = v.w / facteur
      const h = v.h / facteur
      // Le point sous l'ancre (fractions 0-1 du cadre) reste fixe.
      const next = clampView({
        x: v.x + a.px * v.w - a.px * w,
        y: v.y + a.py * v.h - a.py * h,
        w,
        h,
      })
      return Math.abs(next.w - geometry.base.w) < 1 ? null : next
    })
  }

  // Molette : zoom ancré sur le curseur. Listener natif non-passif (React
  // attache wheel en passif → preventDefault impossible).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      zoomer(e.deltaY < 0 ? 1.25 : 1 / 1.25, {
        px: (e.clientX - rect.left) / rect.width,
        py: (e.clientY - rect.top) / rect.height,
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry.base])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_SEUIL_PX) return
    drag.moved = true
    drag.x = e.clientX
    drag.y = e.clientY
    const rect = e.currentTarget.getBoundingClientRect()
    setView((prev) => {
      const v = prev ?? geometry.base
      return clampView({
        x: v.x - dx * (v.w / rect.width),
        y: v.y - dy * (v.h / rect.height),
        w: v.w,
        h: v.h,
      })
    })
  }

  const onPointerUp = () => {
    // Le flag `moved` est consommé par onClickCapture (qui se déclenche après).
    setTimeout(() => {
      dragRef.current = null
    }, 0)
  }

  const onClickCapture = (e: React.MouseEvent) => {
    if (dragRef.current?.moved) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  const clickable = (seat: SeatView): boolean => {
    if (!onSeatClick) return false
    if (clickAll) return true
    if (seat.status === 'libre') return true
    if (current.has(seat.id)) return true
    if (clickBlocked && seat.status === 'bloque') return true
    return false
  }

  const zoome = view !== null

  return (
    <figure className={styles.figure}>
      <div className={styles.mapWrap}>
        <svg
          ref={svgRef}
          className={zoome ? `${styles.svg} ${styles.svgZoome}` : styles.svg}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          role="img"
          aria-label={caption ?? 'Plan de salle'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={onClickCapture}
        >
          {/* Lettres de rang, sous les sièges. */}
          {geometry.rowLabels.map((l) => (
            <text key={l.key} className={styles.rowLabel} x={l.x} y={l.y} textAnchor={l.anchor}>
              {l.label}
            </text>
          ))}

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
                {seat.status === 'bloque' ? (
                  <path
                    className={styles.cross}
                    d={`M ${seat.x - 4.5} ${seat.y - 4.5} l 9 9 M ${seat.x + 4.5} ${seat.y - 4.5} l -9 9`}
                  />
                ) : (
                  <text className={styles.seatNumber} x={seat.x} y={seat.y}>
                    {seat.number}
                  </text>
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

        <div className={styles.zoomControls}>
          <button type="button" onClick={() => zoomer(1.4)} aria-label="Zoomer">
            +
          </button>
          <button type="button" onClick={() => zoomer(1 / 1.4)} aria-label="Dézoomer">
            −
          </button>
          <button
            type="button"
            onClick={() => setView(null)}
            disabled={!zoome}
            aria-label="Vue complète"
          >
            ⟲
          </button>
        </div>
      </div>

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
        <span className={styles.legendHint}>molette : zoom · glisser : déplacer</span>
      </figcaption>
    </figure>
  )
}
