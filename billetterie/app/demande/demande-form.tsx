'use client'

// Formulaire public de demande de places — composant client (useActionState).
// La liste des représentations (déjà filtrées jauge > 0, dates formatées)
// vient du server component app/page.tsx.

import { useActionState, useState } from 'react'

import { formatFrPhone } from '@/lib/public/phone'

import { creerDemande, type DemandeState } from './actions'
import styles from './demande-form.module.css'

const initialState: DemandeState = { ok: false }

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8]

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null
  return <p className={styles.fieldError}>{messages[0]}</p>
}

export default function DemandeForm({
  representationId,
}: {
  // Une seule représentation par an : pas de choix, transmise en champ caché.
  representationId: string
}) {
  const [state, formAction, pending] = useActionState(creerDemande, initialState)
  const [phone, setPhone] = useState('')
  const [pmr, setPmr] = useState(false)

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
      <input type="hidden" name="representationId" value={representationId} />

      <div className={styles.field}>
        <label htmlFor="firstName">Prénom</label>
        <input
          id="firstName"
          name="firstName"
          type="text"
          autoComplete="given-name"
          maxLength={60}
          required
          aria-invalid={errors?.firstName ? true : undefined}
        />
        <FieldError messages={errors?.firstName} />
      </div>

      <div className={styles.field}>
        <label htmlFor="lastName">Nom</label>
        <input
          id="lastName"
          name="lastName"
          type="text"
          autoComplete="family-name"
          maxLength={60}
          required
          aria-invalid={errors?.lastName ? true : undefined}
        />
        <FieldError messages={errors?.lastName} />
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
          inputMode="tel"
          autoComplete="tel"
          placeholder="06 12 34 56 78"
          maxLength={14}
          required
          value={phone}
          onChange={(e) => setPhone(formatFrPhone(e.target.value))}
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
        <p className={styles.hint}>
          Nous plaçons chaque famille <strong>ensemble</strong> autant que possible. Selon le
          remplissage, il arrive qu&apos;un groupe soit réparti sur deux rangs voisins (les uns
          devant les autres).
        </p>
        <FieldError messages={errors?.partySize} />
      </div>

      <fieldset className={styles.pmr}>
        <label className={styles.pmrToggle}>
          <input
            type="checkbox"
            name="pmr"
            checked={pmr}
            onChange={(e) => setPmr(e.target.checked)}
          />
          Une personne à mobilité réduite (PMR / fauteuil roulant) fait partie du groupe
        </label>

        {pmr && (
          <div className={styles.field}>
            <label htmlFor="pmrCompanions">Places accompagnant juste à côté de la personne PMR</label>
            <select id="pmrCompanions" name="pmrCompanions" defaultValue="0">
              <option value="0">Non, pas besoin</option>
              <option value="1">Oui, 1 place</option>
              <option value="2">Oui, 2 places</option>
              <option value="3">Oui, 3 places</option>
            </select>
            <p className={styles.hint}>
              Ces places seront placées <strong>immédiatement à côté</strong> de l&apos;emplacement
              PMR. Le reste du groupe est installé au plus près.
            </p>
          </div>
        )}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor="notes">Commentaire (facultatif)</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={500}
          placeholder="Une demande particulière ? (siège proche d'une sortie, etc.)"
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
