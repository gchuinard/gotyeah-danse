'use client'

// Formulaire « voir ma place » : email + code de place → siège + QR en lecture
// seule, rendu en place (useActionState, pas de navigation). Réutilise le
// QrFullscreen de la page billets (tap → plein écran pour le scan).

import { useActionState, useState } from 'react'

import QrFullscreen from '@/app/billets/[publicToken]/qr-fullscreen'

import { voirPlace, type PlaceState } from './actions'
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

      {state.vue && (
        <article className={styles.placeCard} aria-live="polite">
          <p className={styles.placeKicker}>Lecture seule · place partagée</p>
          <h2 className={styles.placeTitle}>{state.vue.repTitre}</h2>
          <p className={styles.placeDate}>{state.vue.repDateLabel}</p>
          <dl className={styles.placeSeat}>
            <div>
              <dt>Section</dt>
              <dd>{state.vue.section}</dd>
            </div>
            <div>
              <dt>Rang</dt>
              <dd>{state.vue.rang}</dd>
            </div>
            <div>
              <dt>Place</dt>
              <dd>{state.vue.place}</dd>
            </div>
          </dl>

          <QrFullscreen
            src={`/api/qr/${state.vue.qrToken}.png`}
            rang={state.vue.rang}
            place={state.vue.place}
            titre={state.vue.repTitre}
          />

          <p className={styles.placeRecap}>
            Place de la réservation au nom du groupe de <strong>{state.vue.proprioPrenom}</strong>.
          </p>
        </article>
      )}
    </div>
  )
}
