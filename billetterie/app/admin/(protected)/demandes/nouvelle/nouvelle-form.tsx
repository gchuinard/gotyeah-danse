'use client'

// Formulaire admin de création d'une demande. Reprend les champs du formulaire
// public (prénom/nom, email, téléphone masqué, places, commentaire) mais sans
// honeypot. Succès → redirect côté serveur vers la liste.

import { useActionState, useState } from 'react'

import { formatFrPhone } from '@/lib/public/phone'

import { creerDemandeAdmin, type NouvelleDemandeState } from './actions'
import styles from './nouvelle.module.css'

const initialState: NouvelleDemandeState = { ok: false }
const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8]

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null
  return <p className={styles.fieldError}>{messages[0]}</p>
}

export default function NouvelleDemandeForm({
  representationId,
}: {
  // Une seule représentation par an : transmise en champ caché, pas de choix.
  representationId: string
}) {
  const [state, formAction, pending] = useActionState(creerDemandeAdmin, initialState)
  const [phone, setPhone] = useState('')
  const errors = state.fieldErrors

  return (
    <form action={formAction} className={styles.form} noValidate>
      <input type="hidden" name="representationId" value={representationId} />

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="firstName">Prénom</label>
          <input id="firstName" name="firstName" type="text" maxLength={60} required />
          <FieldError messages={errors?.firstName} />
        </div>
        <div className={styles.field}>
          <label htmlFor="lastName">Nom</label>
          <input id="lastName" name="lastName" type="text" maxLength={60} required />
          <FieldError messages={errors?.lastName} />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" maxLength={200} required />
        <FieldError messages={errors?.email} />
      </div>

      <div className={styles.field}>
        <label htmlFor="phone">Téléphone</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="06 12 34 56 78"
          maxLength={14}
          required
          value={phone}
          onChange={(e) => setPhone(formatFrPhone(e.target.value))}
        />
        <FieldError messages={errors?.phone} />
      </div>

      <div className={styles.field}>
        <label htmlFor="partySize">Nombre de places</label>
        <select id="partySize" name="partySize" defaultValue="1" required>
          {PARTY_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} {n > 1 ? 'places' : 'place'}
            </option>
          ))}
        </select>
        <FieldError messages={errors?.partySize} />
      </div>

      <div className={styles.field}>
        <label htmlFor="notes">Commentaire (facultatif)</label>
        <textarea id="notes" name="notes" rows={2} maxLength={500} placeholder="Place PMR, demande particulière…" />
        <FieldError messages={errors?.notes} />
      </div>

      {state.error && (
        <p className={styles.formError} role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? 'Création…' : 'Créer la demande'}
      </button>
    </form>
  )
}
