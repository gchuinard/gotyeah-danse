'use client'

// Formulaire public de demande de places — composant client (useActionState).
// La liste des représentations (déjà filtrées jauge > 0, dates formatées)
// vient du server component app/page.tsx.

import { useActionState, useEffect, useState } from 'react'
import Script from 'next/script'

import { euros } from '@/lib/admin/money'
import { MAX_PARTY_SIZE, PARTY_SIZES } from '@/lib/public/limits'
import { formatFrPhone } from '@/lib/public/phone'

import { creerDemande, type DemandeState } from './actions'
import styles from './demande-form.module.css'

const initialState: DemandeState = { ok: false }

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null
  return <p className={styles.fieldError}>{messages[0]}</p>
}

export default function DemandeForm({
  representationId,
  turnstileSiteKey,
  formRenderedAt,
  adultPriceCents,
  childPriceCents,
}: {
  // Une seule représentation par an : pas de choix, transmise en champ caché.
  representationId: string
  // Clé publique Turnstile — fournie SEULEMENT si le CAPTCHA est actif côté
  // serveur (clé secrète présente), pour éviter toute « fausse confiance ».
  turnstileSiteKey?: string
  // Heure de rendu serveur (time-trap) : base fiable, indépendante de la vitesse
  // d'hydratation et de l'horloge du client.
  formRenderedAt: number
  // Tarifs globaux (centimes) pour le montant indicatif. null = non défini.
  adultPriceCents?: number | null
  childPriceCents?: number | null
}) {
  const [state, formAction, pending] = useActionState(creerDemande, initialState)
  // Token Turnstile : tant que le widget n'a pas résolu (script CDN en cours de
  // chargement), on désactive l'envoi — sinon un POST partirait sans token et
  // serait rejeté à tort. Callbacks branchés via les attributs data-* du widget.
  const [turnstileToken, setTurnstileToken] = useState('')
  useEffect(() => {
    if (!turnstileSiteKey) return
    const w = window as unknown as {
      __onTurnstile?: (token?: string) => void
      __onTurnstileExpired?: () => void
    }
    w.__onTurnstile = (token) => setTurnstileToken(token ?? '')
    w.__onTurnstileExpired = () => setTurnstileToken('')
    return () => {
      w.__onTurnstile = undefined
      w.__onTurnstileExpired = undefined
    }
  }, [turnstileSiteKey])
  // Champs CONTRÔLÉS : une erreur de validation ne vide pas la saisie.
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [phone, setPhone] = useState('')
  const [partySize, setPartySize] = useState(1)
  const [childCount, setChildCount] = useState(0)
  const [pmr, setPmr] = useState(false)
  const [pmrCount, setPmrCount] = useState(1)
  const [accompagnants, setAccompagnants] = useState(0)

  // Montant indicatif : adultes × tarif adulte + enfants × tarif enfant. null si
  // un tarif nécessaire manque (on n'affiche alors pas d'estimation).
  const adultes = Math.max(0, partySize - childCount)
  const estimation = ((): number | null => {
    let total = 0
    if (adultes > 0) {
      if (adultPriceCents == null) return null
      total += adultes * adultPriceCents
    }
    if (childCount > 0) {
      if (childPriceCents == null) return null
      total += childCount * childPriceCents
    }
    return total
  })()
  // Ventilation lisible : « 3 adultes × 12,00 € + 2 enfants × 6,00 € ».
  const estimationDetail = [
    adultes > 0 && adultPriceCents != null
      ? `${adultes} adulte${adultes > 1 ? 's' : ''} × ${euros(adultPriceCents)}`
      : null,
    childCount > 0 && childPriceCents != null
      ? `${childCount} enfant${childCount > 1 ? 's' : ''} × ${euros(childPriceCents)}`
      : null,
  ]
    .filter(Boolean)
    .join(' + ')

  // Le groupe = personnes PMR + accompagnants à coller + reste. On ne peut pas
  // avoir plus de PMR que de places, ni plus d'accompagnants que de places
  // non-PMR restantes.
  const maxPmr = partySize
  const maxAccompagnants = Math.max(0, Math.min(3, partySize - pmrCount))

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
      <input type="hidden" name="ts" value={formRenderedAt} />

      <div className={styles.field}>
        <label htmlFor="firstName">Prénom</label>
        <input
          id="firstName"
          name="firstName"
          type="text"
          autoComplete="given-name"
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
          autoComplete="family-name"
          maxLength={60}
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
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
          value={partySize}
          required
          aria-invalid={errors?.partySize ? true : undefined}
          onChange={(e) => {
            const n = Number(e.target.value)
            // Si on réduit les places, on ramène enfants, PMR puis accompagnants.
            const newPmr = Math.min(Math.max(1, pmrCount), n)
            setPartySize(n)
            setChildCount((c) => Math.min(c, n))
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
        <p className={styles.hint}>
          Plus de {MAX_PARTY_SIZE} places ? Contactez-nous aux permanences de l&apos;école.
        </p>
        <p className={styles.hint}>
          Nous regroupons au mieux les personnes d&apos;une même commande. Il existe un{' '}
          <strong>risque de séparation</strong>{' '}du groupe&nbsp;: le cas échéant, le placement se
          fait <strong>avec vous</strong>, jamais sans vous prévenir.
        </p>
        <FieldError messages={errors?.partySize} />
      </div>

      <div className={styles.field}>
        <label htmlFor="childCount">Dont enfants (tarif réduit)</label>
        <select
          id="childCount"
          name="childCount"
          value={childCount}
          onChange={(e) => setChildCount(Number(e.target.value))}
        >
          {Array.from({ length: partySize + 1 }, (_, i) => i).map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Aucun enfant' : `${n} enfant${n > 1 ? 's' : ''}`}
            </option>
          ))}
        </select>
        {estimation != null && (
          <p className={styles.estimate}>
            À régler au studio&nbsp;: {estimationDetail} ={' '}
            <strong>{euros(estimation)}</strong>{' '}
            <span className={styles.estimateNote}>(montant indicatif)</span>
          </p>
        )}
        <p className={styles.hint}>
          Nombre de places au <strong>tarif enfant</strong>{' '}— l&apos;équipe confirme à
          l&apos;inscription au studio.
        </p>
        <FieldError messages={errors?.childCount} />
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
          <span>Une personne à mobilité réduite (PMR / fauteuil roulant) fait partie du groupe</span>
        </label>

        {pmr && (
          <>
            <div className={styles.field}>
              <label htmlFor="pmrCount">Combien de personnes en fauteuil / PMR&nbsp;?</label>
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
              <p className={styles.hint}>
                Un <strong>emplacement PMR</strong> est réservé pour chacune de ces personnes.
              </p>
            </div>

            <div className={styles.field}>
              <label htmlFor="pmrCompanions">Places accompagnant juste à côté</label>
              <select
                id="pmrCompanions"
                name="pmrCompanions"
                value={accompagnants}
                onChange={(e) => setAccompagnants(Number(e.target.value))}
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n} disabled={n > maxAccompagnants}>
                    {n === 0 ? 'Non, pas besoin' : `Oui, ${n} place${n > 1 ? 's' : ''}`}
                    {n > maxAccompagnants ? ` — il faut au moins ${pmrCount + n} places` : ''}
                  </option>
                ))}
              </select>
              <p className={styles.hint}>
                Chaque accompagnant occupe une de vos places (en plus des personnes PMR). Pour en
                ajouter, augmentez d&apos;abord le <strong>nombre de places</strong> ci-dessus.
              </p>
              <p className={styles.hint}>
                Ces places seront installées <strong>immédiatement à côté</strong> des emplacements
                PMR. Le reste du groupe est placé au plus près.
              </p>
            </div>
          </>
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
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
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

      {/* Turnstile (CAPTCHA invisible) : pose un input caché cf-turnstile-response
          dans le formulaire. Rendu uniquement si le CAPTCHA est actif (clé). */}
      {turnstileSiteKey && (
        <>
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            strategy="afterInteractive"
          />
          <div
            className="cf-turnstile"
            data-sitekey={turnstileSiteKey}
            data-callback="__onTurnstile"
            data-expired-callback="__onTurnstileExpired"
          />
        </>
      )}

      <button
        type="submit"
        className={styles.submit}
        disabled={pending || (Boolean(turnstileSiteKey) && !turnstileToken)}
      >
        {pending
          ? 'Envoi en cours…'
          : turnstileSiteKey && !turnstileToken
            ? 'Vérification de sécurité…'
            : 'Envoyer ma demande'}
      </button>
    </form>
  )
}
