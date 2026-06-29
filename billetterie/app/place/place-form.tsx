'use client'

// Formulaire « voir ma place » : email + code de place → siège + QR en lecture
// seule (PlaceCard), rendu en place (useActionState, pas de navigation).

import { useActionState, useState } from 'react'

import { voirPlace, type PlaceState } from './actions'
import PlaceCard from './place-card'
import styles from './place.module.css'

const initialState: PlaceState = {}

export default function PlaceForm() {
  const [state, formAction, pending] = useActionState(voirPlace, initialState)
  // Champs CONTRÔLÉS : une erreur (mauvais code/email) ne vide pas la saisie.
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  return (
    <div>
      <form action={formAction} className={styles.form} noValidate>
        <div className={styles.field}>
          <label htmlFor="place-email">Email de la réservation</label>
          <input
            id="place-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={200}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="place-code">Code de la place</label>
          <input
            id="place-code"
            name="code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            placeholder="ex. GC1234"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            style={{ textTransform: 'uppercase', letterSpacing: '2px' }}
          />
        </div>

        {state.error && (
          <p className={styles.formError} role="alert">
            {state.error}
          </p>
        )}

        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? 'Recherche…' : 'Voir ma place'}
        </button>
      </form>

      {state.vue && <PlaceCard data={state.vue} />}
    </div>
  )
}
