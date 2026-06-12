'use client'

// Partie interactive de l'écran de placement : suggestions, sélection
// manuelle sur le plan, validation. La suggestion 1 est pré-appliquée au
// chargement ; cliquer une suggestion REMPLACE la sélection par ses sièges.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import SeatMap from '@/components/admin/seat-map'
import type { SeatView } from '@/lib/admin/seat-map'

import { validerPlacement } from './actions'
import styles from './placement.module.css'

type SuggestionView = { seatIds: string[]; score: number }

type Props = {
  bookingId: string
  mode: 'emission' | 'deplacement'
  partySize: number
  seats: SeatView[]
  currentIds: string[]
  suggestions: SuggestionView[]
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export default function PlacementView({
  bookingId,
  mode,
  partySize,
  seats,
  currentIds,
  suggestions,
}: Props) {
  const router = useRouter()
  // En déplacement : pré-sélection des places ACTUELLES de la réservation.
  // En émission : suggestion 1 pré-appliquée (si le moteur en a trouvé).
  const [selection, setSelection] = useState<string[]>(
    mode === 'deplacement' ? currentIds : (suggestions[0]?.seatIds ?? []),
  )
  const [hovered, setHovered] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const highlightedIds = useMemo(
    () => (hovered !== null ? suggestions[hovered]?.seatIds : undefined),
    [hovered, suggestions],
  )

  const toggleSeat = (seat: SeatView) => {
    setSelection((prev) =>
      prev.includes(seat.id) ? prev.filter((id) => id !== seat.id) : [...prev, seat.id],
    )
  }

  const applySuggestion = (index: number) => {
    const suggestion = suggestions[index]
    if (suggestion) setSelection([...suggestion.seatIds])
  }

  const valider = () => {
    setError(null)
    startTransition(async () => {
      // Succès → redirect('/admin/demandes') côté serveur, on ne revient pas.
      const result = await validerPlacement({ bookingId, seatIds: selection, mode })
      if (result && !result.ok) setError(result.error)
    })
  }

  return (
    <div className={styles.layout}>
      <div className={styles.mapColumn}>
        <SeatMap
          seats={seats}
          selectedIds={selection}
          highlightedIds={highlightedIds}
          currentIds={mode === 'deplacement' ? currentIds : undefined}
          onSeatClick={toggleSeat}
          caption={mode === 'deplacement' ? 'Les places actuelles de la famille sont cliquables.' : undefined}
        />
      </div>

      <aside className={styles.panel}>
        <section className={styles.panelBlock}>
          <h2 className={styles.panelTitle}>Suggestions</h2>
          <div className={styles.suggestions}>
            {[0, 1, 2].map((i) => {
              const suggestion = suggestions[i]
              const active = suggestion !== undefined && sameIds(selection, suggestion.seatIds)
              return (
                <button
                  key={i}
                  type="button"
                  className={active ? styles.suggestionActive : styles.suggestion}
                  disabled={suggestion === undefined}
                  aria-pressed={active}
                  onClick={() => applySuggestion(i)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                >
                  Suggestion {i + 1}
                  {suggestion !== undefined && (
                    <span className={styles.suggestionScore}>score {suggestion.score}</span>
                  )}
                </button>
              )
            })}
          </div>
          {suggestions.length === 0 && (
            <p className={styles.panelHint}>
              Aucune suggestion automatique — sélectionnez les places à la main sur le plan.
            </p>
          )}
        </section>

        <section className={styles.panelBlock}>
          <h2 className={styles.panelTitle}>Sélection</h2>
          <p className={styles.counter} aria-live="polite">
            <strong>
              {selection.length}/{partySize}
            </strong>{' '}
            sélectionné{selection.length > 1 ? 's' : ''}
          </p>

          <button
            type="button"
            className={styles.cancel}
            onClick={() => setSelection([])}
            disabled={pending || selection.length === 0}
          >
            Tout désélectionner
          </button>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            className={styles.validate}
            onClick={valider}
            disabled={pending || selection.length !== partySize}
          >
            {pending
              ? 'Validation…'
              : mode === 'emission'
                ? 'Valider ce placement'
                : 'Valider le déplacement'}
          </button>
          {selection.length !== partySize && (
            <p className={styles.panelHint}>
              Sélectionnez exactement {partySize} place{partySize > 1 ? 's' : ''} pour valider.
            </p>
          )}

          {mode === 'deplacement' && (
            <button
              type="button"
              className={styles.cancel}
              onClick={() => router.push('/admin/demandes')}
              disabled={pending}
            >
              Annuler le déplacement
            </button>
          )}
        </section>
      </aside>
    </div>
  )
}
