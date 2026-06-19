'use client'

// Formulaire admin de création d'une demande. Reprend les champs du formulaire
// public (prénom/nom, email, téléphone masqué, places, commentaire) mais sans
// honeypot. Succès → redirect côté serveur vers la liste.

import { useActionState, useState } from 'react'

import { PARTY_SIZES } from '@/lib/public/limits'
import { formatFrPhone } from '@/lib/public/phone'

import { creerDemandeAdmin, type NouvelleDemandeState } from './actions'
import styles from './nouvelle.module.css'

const initialState: NouvelleDemandeState = { ok: false }

// Libellés FR pour nommer les champs en erreur dans le message global.
const FIELD_LABELS: Record<string, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  email: 'Email',
  phone: 'Téléphone',
  partySize: 'Nombre de places',
  notes: 'Commentaire',
}

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
  // Champs CONTRÔLÉS : une erreur de validation ne vide pas la saisie (React 19
  // réinitialise les champs NON contrôlés après une action de formulaire).
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [partySize, setPartySize] = useState(1)
  const [pmr, setPmr] = useState(false)
  const [pmrCount, setPmrCount] = useState(1)
  const [accompagnants, setAccompagnants] = useState(0)
  const maxPmr = partySize
  const maxAccompagnants = Math.min(3, partySize - pmrCount)
  const errors = state.fieldErrors
  const champsEnErreur = errors
    ? Object.entries(errors)
        .filter(([, v]) => v && v.length)
        .map(([k]) => FIELD_LABELS[k] ?? k)
    : []

  return (
    <form action={formAction} className={styles.form} noValidate>
      <input type="hidden" name="representationId" value={representationId} />

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="firstName">Prénom</label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            maxLength={60}
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
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
            maxLength={60}
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            aria-invalid={errors?.lastName ? true : undefined}
          />
          <FieldError messages={errors?.lastName} />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          maxLength={200}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
          value={partySize}
          required
          onChange={(e) => {
            const n = Number(e.target.value)
            const newPmr = Math.min(Math.max(1, pmrCount), n)
            setPartySize(n)
            setPmrCount(newPmr)
            setAccompagnants((a) => Math.min(a, Math.max(0, n - newPmr)))
          }}
        >
          {PARTY_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} {n > 1 ? 'places' : 'place'}
            </option>
          ))}
        </select>
        <FieldError messages={errors?.partySize} />
      </div>

      <fieldset className={styles.pmr}>
        <label className={styles.pmrToggle}>
          <input
            type="checkbox"
            role="switch"
            className={styles.switch}
            checked={pmr}
            onChange={(e) => {
              const on = e.target.checked
              setPmr(on)
              if (on) {
                setPmrCount(1)
                setAccompagnants(0)
              }
            }}
          />
          <span>Personne(s) à mobilité réduite (PMR) dans le groupe</span>
        </label>
        {pmr && (
          <>
            <div className={styles.field}>
              <label htmlFor="pmrCount">Combien de personnes PMR&nbsp;?</label>
              <select
                id="pmrCount"
                name="pmrCount"
                value={pmrCount}
                onChange={(e) => {
                  const c = Number(e.target.value)
                  setPmrCount(c)
                  setAccompagnants((a) => Math.min(a, Math.max(0, partySize - c)))
                }}
              >
                {Array.from({ length: maxPmr }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} personne{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="pmrCompanions">Places accompagnant à coller à côté</label>
              <select
                id="pmrCompanions"
                name="pmrCompanions"
                value={accompagnants}
                onChange={(e) => setAccompagnants(Number(e.target.value))}
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n} disabled={n > maxAccompagnants}>
                    {n === 0 ? 'Non, pas besoin' : `Oui, ${n} place${n > 1 ? 's' : ''}`}
                    {n > maxAccompagnants ? ` — min. ${pmrCount + n} places` : ''}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor="notes">Commentaire (facultatif)</label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={500}
          placeholder="Demande particulière…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-invalid={errors?.notes ? true : undefined}
        />
        <FieldError messages={errors?.notes} />
      </div>

      {(champsEnErreur.length > 0 || state.error) && (
        <p className={styles.formError} role="alert">
          {champsEnErreur.length > 0
            ? `À corriger : ${champsEnErreur.join(', ')}.`
            : state.error}
        </p>
      )}

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? 'Création…' : 'Créer la demande'}
      </button>
    </form>
  )
}
