'use client'

// Onglet « J'ai déjà une demande » : email + identifiant (reçu par mail) →
// page de la demande (modifiable si en attente, billets si placée). Lien
// « identifiant oublié ? » qui le renvoie par mail.

import { useActionState, useState } from 'react'

import { accederDemande, renvoyerIdentifiant, type AccesState } from './actions'
import styles from './demande-form.module.css'

const initialState: AccesState = {}

export default function AccesForm() {
  const [state, formAction, pending] = useActionState(accederDemande, initialState)
  const [oubli, setOubli] = useState(false)
  const [renvoi, renvoiAction, renvoiPending] = useActionState(renvoyerIdentifiant, initialState)
  // Champs CONTRÔLÉS : une erreur (mauvais code/email) ne vide pas la saisie.
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [renvoiEmail, setRenvoiEmail] = useState('')

  return (
    <div>
      <form action={formAction} className={styles.form} noValidate>
        <p className={styles.hint}>
          Retrouvez votre demande pour la <strong>modifier</strong>, l&apos;<strong>annuler</strong>
          {' '}ou voir vos <strong>billets</strong>. Saisissez votre email et l&apos;
          <strong>identifiant</strong> reçu par mail à la création.
        </p>

        <div className={styles.field}>
          <label htmlFor="acces-email">Email</label>
          <input
            id="acces-email"
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
          <label htmlFor="acces-code">Identifiant de demande</label>
          <input
            id="acces-code"
            name="code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            placeholder="ex. AB3CDE"
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
          {pending ? 'Recherche…' : 'Accéder à ma demande'}
        </button>

        <button type="button" className={styles.lien} onClick={() => setOubli((o) => !o)}>
          Identifiant oublié ou perdu ?
        </button>
      </form>

      {oubli && (
        <form action={renvoiAction} className={styles.form} noValidate>
          <p className={styles.hint}>
            Entrez l&apos;email utilisé lors de la demande : nous vous renvoyons votre identifiant.
          </p>
          <div className={styles.field}>
            <label htmlFor="renvoi-email">Email</label>
            <input
              id="renvoi-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={200}
              required
              value={renvoiEmail}
              onChange={(e) => setRenvoiEmail(e.target.value)}
            />
          </div>
          {renvoi.renvoye && (
            <p className={styles.confirmation} role="status">
              Si une demande existe pour cet email, votre identifiant vient d&apos;être renvoyé.
              Vérifiez votre boîte mail (et les spams).
            </p>
          )}
          {renvoi.error && (
            <p className={styles.formError} role="alert">
              {renvoi.error}
            </p>
          )}
          <button type="submit" className={styles.submit} disabled={renvoiPending}>
            {renvoiPending ? 'Envoi…' : 'Renvoyer mon identifiant'}
          </button>
        </form>
      )}
    </div>
  )
}
