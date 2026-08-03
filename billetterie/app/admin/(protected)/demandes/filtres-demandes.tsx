'use client'

// Barre de filtres de la liste des demandes — filtrage LIVE (au fil de la
// frappe, sans bouton) + bouton « Rafraîchir » (recharge les données serveur).
//
// L'input et le select pilotent l'URL (router.replace, debounce 250 ms) : le
// server component se re-rend filtré, l'instance client est préservée donc le
// champ garde le focus pendant la frappe.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import styles from './demandes.module.css'

const STATUTS = [
  { value: '', label: 'Tous' },
  { value: 'pending', label: 'En attente' },
  { value: 'expiree', label: 'Expirées' },
  { value: 'paid', label: 'À placer' },
  { value: 'placed', label: 'Placées' },
  { value: 'cancelled', label: 'Annulées' },
] as const

const PAIEMENTS = [
  { value: '', label: 'Tous' },
  { value: 'paye', label: 'Payées' },
  { value: 'impaye', label: 'Non payées' },
] as const

export function FiltresDemandes({
  statut,
  q,
  paiement,
  archives,
}: {
  statut: string
  q: string
  paiement: string
  // Vue « archives » (lecture seule) : à RECONDUIRE dans l'URL à chaque
  // changement de filtre, sinon on retomberait sur les demandes en cours.
  archives: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [recherche, setRecherche] = useState(q)
  const [statutChoisi, setStatutChoisi] = useState(statut)
  const [paiementChoisi, setPaiementChoisi] = useState(paiement)
  const premierRendu = useRef(true)

  const naviguer = (s: string, r: string, p: string) => {
    const params = new URLSearchParams()
    if (archives) params.set('archives', '1')
    if (s) params.set('statut', s)
    if (p) params.set('paiement', p)
    if (r.trim()) params.set('q', r.trim())
    const qs = params.toString()
    startTransition(() => router.replace('/admin/demandes' + (qs ? `?${qs}` : '')))
  }

  // Débounce : 250 ms après la dernière frappe / le dernier changement.
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false
      return
    }
    const t = setTimeout(() => naviguer(statutChoisi, recherche, paiementChoisi), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recherche, statutChoisi, paiementChoisi])

  // Réinitialiser vide les FILTRES, pas le périmètre : on reste sur la vue
  // courante (en cours / archives).
  const reinitialiser = () => {
    setRecherche('')
    setStatutChoisi('')
    setPaiementChoisi('')
    startTransition(() =>
      router.replace('/admin/demandes' + (archives ? '?archives=1' : '')),
    )
  }

  return (
    <div className={styles.filtres}>
      <label>
        Statut
        <select value={statutChoisi} onChange={(e) => setStatutChoisi(e.target.value)}>
          {STATUTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Paiement
        <select value={paiementChoisi} onChange={(e) => setPaiementChoisi(e.target.value)}>
          {PAIEMENTS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Recherche
        <input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Nom, email ou téléphone…"
        />
      </label>

      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        title="Recharger la liste des demandes"
      >
        ↻ Rafraîchir
      </button>

      {(statutChoisi || recherche || paiementChoisi) && (
        <button type="button" className={styles.filtreReset} onClick={reinitialiser}>
          Réinitialiser
        </button>
      )}

      {pending && (
        <span className={styles.filtreEtat} aria-live="polite">
          mise à jour…
        </span>
      )}
    </div>
  )
}
