'use client'

// Vue plan interactive : polling 5 s (multi-bénévoles) + mode édition.
//
// Le mode « édition » regroupe blocage et amovible en UN clic qui cycle :
//   valide → bloqué → amovible → valide
// (cf. cyclerSiege côté serveur). Le blocage est par représentation,
// l'amovible est une propriété physique du fauteuil (toutes représentations).

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import SeatMap from '@/components/admin/seat-map'
import { PMR_REASON, type SeatView } from '@/lib/admin/seat-map'

import { cyclerSiege, type EtatSiege } from './actions'
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

type Mode = 'consultation' | 'edition'

// État « de cycle » d'un siège (occupé : hors cycle).
function etatDe(seat: SeatView): EtatSiege | 'occupe' {
  if (seat.status === 'occupe') return 'occupe'
  if (seat.status === 'bloque') return seat.overrideReason === PMR_REASON ? 'pmr' : 'bloque'
  return seat.removable ? 'amovible' : 'valide'
}

export default function PlanView({ representations, repId, initialSeats }: Props) {
  const router = useRouter()
  const [seats, setSeats] = useState<SeatView[]>(initialSeats)
  const [mode, setMode] = useState<Mode>('consultation')
  const [reasonChoice, setReasonChoice] = useState<string>('console_son')
  const [customReason, setCustomReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

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
    let pmr = 0
    let amovibles = 0
    for (const s of seats) {
      if (s.status === 'occupe') occupes += 1
      else if (s.status === 'bloque') {
        if (s.overrideReason === PMR_REASON) pmr += 1
        else bloques += 1
      } else {
        libres += 1
        if (s.removable) amovibles += 1
      }
    }
    return { libres, occupes, bloques, pmr, amovibles, capacite: seats.length }
  }, [seats])

  const effectiveReason =
    (reasonChoice === 'autre' ? customReason.trim() : reasonChoice) || 'autre'

  const quitterMode = () => {
    setMode('consultation')
    setError(null)
  }

  // Applique localement (optimiste) un état de cycle à un siège.
  const appliquer = (id: string, etat: EtatSiege, reason?: string) => {
    setSeats((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        if (etat === 'pmr') return { ...s, status: 'bloque', overrideReason: PMR_REASON }
        if (etat === 'bloque') return { ...s, status: 'bloque', overrideReason: reason }
        if (etat === 'amovible')
          return { ...s, status: 'libre', removable: true, overrideReason: undefined }
        return { ...s, status: 'libre', removable: false, overrideReason: undefined }
      }),
    )
  }

  // Un clic = un cran de cycle. Optimiste, puis réconciliation sur la réponse
  // serveur (qui fait foi : il relit l'état réel en base).
  const cycler = (seat: SeatView) => {
    const courant = etatDe(seat)
    if (courant === 'occupe') return
    const suivant: EtatSiege =
      courant === 'valide'
        ? 'bloque'
        : courant === 'bloque'
          ? 'pmr'
          : courant === 'pmr'
            ? 'amovible'
            : 'valide'

    setError(null)
    appliquer(seat.id, suivant, effectiveReason)
    startTransition(async () => {
      const result = await cyclerSiege({ repId, seatId: seat.id, reason: effectiveReason })
      if (!result.ok) {
        setError(result.error)
        appliquer(seat.id, courant, seat.overrideReason) // rétablit
        return
      }
      appliquer(seat.id, result.state, result.reason)
    })
  }

  const enEdition = mode === 'edition'

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
            <dt>PMR</dt>
            <dd>{stats.pmr}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Amovibles</dt>
            <dd>{stats.amovibles}</dd>
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
            onSeatClick={enEdition ? cycler : undefined}
            clickAll={enEdition}
            caption={
              enEdition
                ? 'Mode édition — chaque clic : valide → bloqué → réservé PMR → amovible → valide'
                : undefined
            }
          />
        </div>

        <aside className={styles.panel}>
          {mode === 'consultation' && (
            <button type="button" className={styles.primary} onClick={() => setMode('edition')}>
              Gérer les sièges
            </button>
          )}

          {mode === 'edition' && (
            <div className={styles.overridePanel}>
              <h2 className={styles.panelTitle}>Gérer les sièges</h2>
              <p className={styles.panelHint}>
                Cliquez un siège pour le faire défiler&nbsp;:
              </p>
              <ol className={styles.cycleList}>
                <li>
                  <span className={`${styles.dot} ${styles.dotLibre}`} /> <strong>valide</strong> —
                  disponible à la vente
                </li>
                <li>
                  <span className={`${styles.dot} ${styles.dotBloque}`} /> <strong>bloqué</strong>{' '}
                  — neutralisé pour CETTE représentation (raison ci-dessous)
                </li>
                <li>
                  <span className={`${styles.dot} ${styles.dotPmr}`} />{' '}
                  <strong>réservé PMR</strong> — gardé pour une personne à mobilité réduite (cette
                  représentation)
                </li>
                <li>
                  <span className={`${styles.dot} ${styles.dotRemovable}`} />{' '}
                  <strong>amovible</strong> — fauteuil démontable (propriété du siège, TOUTES les
                  représentations)
                </li>
              </ol>

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

              <p className={styles.panelHint}>
                Un siège déjà attribué (occupé) ne peut pas être modifié. Les bascules survivent
                aux synchronisations du plan.
              </p>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}

              <div className={styles.panelActions}>
                <button type="button" className={styles.ghost} onClick={quitterMode}>
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
