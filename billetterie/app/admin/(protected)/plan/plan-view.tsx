'use client'

// Vue plan interactive : polling 5 s (multi-bénévoles) + mode blocages.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import SeatMap from '@/components/admin/seat-map'
import type { SeatView } from '@/lib/admin/seat-map'

import { bloquerSieges, debloquerSieges } from './actions'
import styles from './plan.module.css'

const POLL_MS = 5000

const REASON_OPTIONS = [
  { value: 'console_son', label: 'Console son' },
  { value: 'fosse_avant_scene', label: 'Fosse avant-scène' },
  { value: 'amovibles_non_poses', label: 'Amovibles non posés' },
  { value: 'autre', label: 'Autre…' },
] as const

type Props = {
  representations: { id: string; label: string }[]
  repId: string
  initialSeats: SeatView[]
}

export default function PlanView({ representations, repId, initialSeats }: Props) {
  const router = useRouter()
  const [seats, setSeats] = useState<SeatView[]>(initialSeats)
  const [overrideMode, setOverrideMode] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const [reasonChoice, setReasonChoice] = useState<string>('console_son')
  const [customReason, setCustomReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Re-synchronise quand le serveur renvoie un nouvel état (revalidation
  // après une action) — pattern « adjusting state during render », pas
  // d'effet pour éviter un rendu en cascade. Le changement de représentation
  // remonte via la key du composant (voir page.tsx) et réinitialise tout.
  const [prevInitialSeats, setPrevInitialSeats] = useState(initialSeats)
  if (prevInitialSeats !== initialSeats) {
    setPrevInitialSeats(initialSeats)
    setSeats(initialSeats)
  }

  // Polling 5 s : un siège occupé/bloqué par un autre bénévole apparaît sans
  // recharger. L'endpoint ne renvoie que des seatIds : le NOM de l'occupant
  // d'un siège nouvellement occupé reste absent jusqu'au prochain
  // rechargement complet de la page — assumé pour garder l'endpoint léger.
  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      if (document.visibilityState === 'hidden') return // onglet caché : pause
      try {
        const res = await fetch(`/api/admin/plan-state/${repId}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { occupied: string[]; blocked: string[] }
        const occupied = new Set(data.occupied)
        const blocked = new Set(data.blocked)
        if (cancelled) return
        setSeats((prev) =>
          prev.map((seat) => {
            const status: SeatView['status'] = occupied.has(seat.id)
              ? 'occupe'
              : blocked.has(seat.id)
                ? 'bloque'
                : 'libre'
            if (status === seat.status) return seat
            return {
              ...seat,
              status,
              occupant: status === 'occupe' ? seat.occupant : undefined,
              overrideReason: status === 'bloque' ? seat.overrideReason : undefined,
            }
          }),
        )
      } catch {
        // Réseau indisponible : on retentera au prochain tick.
      }
    }

    const interval = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [repId])

  const stats = useMemo(() => {
    let libres = 0
    let occupes = 0
    let bloques = 0
    for (const s of seats) {
      if (s.status === 'libre') libres += 1
      else if (s.status === 'occupe') occupes += 1
      else bloques += 1
    }
    return { libres, occupes, bloques, capacite: seats.length }
  }, [seats])

  const seatById = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats])
  const selectedLibres = selection.filter((id) => seatById.get(id)?.status === 'libre')
  const selectedBloques = selection.filter((id) => seatById.get(id)?.status === 'bloque')

  const effectiveReason = reasonChoice === 'autre' ? customReason.trim() : reasonChoice

  const toggleSeat = (seat: SeatView) => {
    setSelection((prev) =>
      prev.includes(seat.id) ? prev.filter((id) => id !== seat.id) : [...prev, seat.id],
    )
  }

  const quitOverrideMode = () => {
    setOverrideMode(false)
    setSelection([])
    setError(null)
  }

  const bloquer = () => {
    setError(null)
    startTransition(async () => {
      const result = await bloquerSieges({ repId, seatIds: selectedLibres, reason: effectiveReason })
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Mise à jour locale immédiate (la revalidation + le polling suivront).
      const blockedNow = new Set(selectedLibres)
      setSeats((prev) =>
        prev.map((s) =>
          blockedNow.has(s.id) ? { ...s, status: 'bloque', overrideReason: effectiveReason } : s,
        ),
      )
      setSelection((prev) => prev.filter((id) => !blockedNow.has(id)))
    })
  }

  const debloquer = () => {
    setError(null)
    startTransition(async () => {
      const result = await debloquerSieges({ repId, seatIds: selectedBloques })
      if (!result.ok) {
        setError(result.error)
        return
      }
      const freedNow = new Set(selectedBloques)
      setSeats((prev) =>
        prev.map((s) =>
          freedNow.has(s.id) ? { ...s, status: 'libre', overrideReason: undefined } : s,
        ),
      )
      setSelection((prev) => prev.filter((id) => !freedNow.has(id)))
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Plan de salle</h1>
        <label className={styles.repPicker}>
          Représentation
          <select
            value={repId}
            onChange={(e) => router.push(`/admin/plan?rep=${encodeURIComponent(e.target.value)}`)}
          >
            {representations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>Libres</dt>
            <dd>{stats.libres}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Occupés</dt>
            <dd>{stats.occupes}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Bloqués</dt>
            <dd>{stats.bloques}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Capacité</dt>
            <dd>{stats.capacite}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.layout}>
        <div className={styles.mapColumn}>
          <SeatMap
            seats={seats}
            selectedIds={overrideMode ? selection : undefined}
            onSeatClick={overrideMode ? toggleSeat : undefined}
            clickBlocked
            caption={overrideMode ? 'Mode blocages — cliquez les sièges à bloquer ou débloquer' : undefined}
          />
        </div>

        <aside className={styles.panel}>
          {!overrideMode ? (
            <button type="button" className={styles.primary} onClick={() => setOverrideMode(true)}>
              Gérer les blocages
            </button>
          ) : (
            <div className={styles.overridePanel}>
              <h2 className={styles.panelTitle}>Blocages</h2>
              <p className={styles.panelHint}>
                {selection.length === 0
                  ? 'Cliquez sur des sièges libres (à bloquer) ou bloqués (à débloquer).'
                  : `${selection.length} siège${selection.length > 1 ? 's' : ''} sélectionné${selection.length > 1 ? 's' : ''} — ${selectedLibres.length} à bloquer, ${selectedBloques.length} à débloquer.`}
              </p>

              <label className={styles.field}>
                Raison du blocage
                <select value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)}>
                  {REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {reasonChoice === 'autre' && (
                <label className={styles.field}>
                  Précisez
                  <input
                    type="text"
                    value={customReason}
                    maxLength={120}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="ex. rangée réservée presse"
                  />
                </label>
              )}

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}

              <div className={styles.panelActions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={bloquer}
                  disabled={pending || selectedLibres.length === 0 || effectiveReason.length === 0}
                >
                  Bloquer la sélection ({selectedLibres.length})
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={debloquer}
                  disabled={pending || selectedBloques.length === 0}
                >
                  Débloquer la sélection ({selectedBloques.length})
                </button>
                <button type="button" className={styles.ghost} onClick={quitOverrideMode}>
                  Terminer
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
