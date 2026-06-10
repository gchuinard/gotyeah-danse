'use client'

// Formulaire public de demande de places — composant client (useActionState).
// La liste des représentations (déjà filtrées jauge > 0, dates formatées)
// vient du server component app/page.tsx.

import { useActionState } from 'react'

import { creerDemande, type DemandeState } from './actions'
import styles from './demande-form.module.css'

export type RepresentationOption = {
  id: string
  label: string
}

const initialState: DemandeState = { ok: false }

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8]

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null
  return <p className={styles.fieldError}>{messages[0]}</p>
}

export default function DemandeForm({
  representations,
}: {
  representations: RepresentationOption[]
}) {
  const [state, formAction, pending] = useActionState(creerDemande, initialState)

  // Succès « générique » (cas honeypot) : confirmation sobre, rien de plus.
  if (state.ok) {
    return (
      <p className={styles.confirmation} role="status">
        Merci, votre demande a bien été enregistrée. Vous recevrez un email de confirmation.
      </p>
    )
  }

  const errors = state.fieldErrors

  return (
    <form action={formAction} className={styles.form} noValidate>
      <div className={styles.field}>
        <label htmlFor="representationId">Représentation</label>
        <select
          id="representationId"
          name="representationId"
          required
          defaultValue=""
          aria-invalid={errors?.representationId ? true : undefined}
        >
          <option value="" disabled>
            Choisissez une représentation…
          </option>
          {representations.map((rep) => (
            <option key={rep.id} value={rep.id}>
              {rep.label}
            </option>
          ))}
        </select>
        <FieldError messages={errors?.representationId} />
      </div>

      <div className={styles.field}>
        <label htmlFor="name">Nom et prénom</label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          maxLength={100}
          required
          aria-invalid={errors?.name ? true : undefined}
        />
        <FieldError messages={errors?.name} />
      </div>

      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={200}
          required
          aria-invalid={errors?.email ? true : undefined}
        />
        <FieldError messages={errors?.email} />
      </div>

      <div className={styles.field}>
        <label htmlFor="phone">Téléphone</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={20}
          required
          aria-invalid={errors?.phone ? true : undefined}
        />
        <FieldError messages={errors?.phone} />
      </div>

      <div className={styles.field}>
        <label htmlFor="partySize">Nombre de places</label>
        <select
          id="partySize"
          name="partySize"
          defaultValue="1"
          required
          aria-invalid={errors?.partySize ? true : undefined}
        >
          {PARTY_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} {n > 1 ? 'places' : 'place'}
            </option>
          ))}
        </select>
        <p className={styles.hint}>
          Plus de 8 places ? Contactez-nous aux permanences de l&apos;école.
        </p>
        <FieldError messages={errors?.partySize} />
      </div>

      <div className={styles.field}>
        <label htmlFor="notes">Commentaire (facultatif)</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={500}
          placeholder="Place PMR, fauteuil roulant, demande particulière…"
          aria-invalid={errors?.notes ? true : undefined}
        />
        <FieldError messages={errors?.notes} />
      </div>

      {/* Honeypot anti-robots : masqué hors écran, jamais rempli par un humain. */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor="website">Site web</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      {state.error && (
        <p className={styles.formError} role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? 'Envoi en cours…' : 'Envoyer ma demande'}
      </button>
    </form>
  )
}
