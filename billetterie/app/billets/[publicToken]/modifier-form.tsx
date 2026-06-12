'use client'

// Édition d'une demande EN ATTENTE par le demandeur (places, PMR, commentaire,
// coordonnées) + annulation. Le token de la page fait office de clé d'accès.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { MAX_PARTY_SIZE } from '@/lib/public/limits'
import { formatFrPhone } from '@/lib/public/phone'

import { annulerDemande, modifierDemande } from './actions'
import styles from '../../demande/demande-form.module.css'

type Props = {
  token: string
  name: string
  phone: string
  partySize: number
  notes: string
  pmr: boolean
  pmrCompanions: number
  maxPlaces: number // jauge restante + places actuelles
}

export default function ModifierForm(props: Props) {
  const router = useRouter()
  const [name, setName] = useState(props.name)
  const [phone, setPhone] = useState(props.phone)
  const [partySize, setPartySize] = useState(props.partySize)
  const [pmr, setPmr] = useState(props.pmr)
  const [accompagnants, setAccompagnants] = useState(props.pmrCompanions)
  const [notes, setNotes] = useState(props.notes)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  // Plafond de places = jauge restante (places actuelles comprises), borné.
  const plafond = Math.min(MAX_PARTY_SIZE, Math.max(1, props.maxPlaces))
  const places = Array.from({ length: plafond }, (_, i) => i + 1)
  const maxAccompagnants = Math.min(3, partySize - 1)

  const enregistrer = async () => {
    setPending(true)
    setError(null)
    setOk(false)
    const res = await modifierDemande({
      token: props.token,
      name,
      phone,
      partySize,
      notes: notes.trim() || undefined,
      pmr,
      pmrCompanions: accompagnants,
    })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOk(true)
    router.refresh()
  }

  const annuler = async () => {
    if (!window.confirm('Annuler définitivement votre demande de places ?')) return
    setPending(true)
    setError(null)
    const res = await annulerDemande(props.token)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
  }

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="m-name">Nom</label>
        <input id="m-name" type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className={styles.field}>
        <label htmlFor="m-phone">Téléphone</label>
        <input
          id="m-phone"
          type="tel"
          inputMode="tel"
          maxLength={14}
          value={phone}
          onChange={(e) => setPhone(formatFrPhone(e.target.value))}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="m-places">Nombre de places</label>
        <select
          id="m-places"
          value={partySize}
          onChange={(e) => {
            const n = Number(e.target.value)
            setPartySize(n)
            setAccompagnants((a) => Math.min(a, Math.max(0, n - 1)))
          }}
        >
          {places.map((n) => (
            <option key={n} value={n}>
              {n} {n > 1 ? 'places' : 'place'}
            </option>
          ))}
        </select>
        <p className={styles.hint}>Maximum {plafond} selon les places encore disponibles.</p>
      </div>

      <fieldset className={styles.pmr}>
        <label className={styles.pmrToggle}>
          <input type="checkbox" checked={pmr} onChange={(e) => setPmr(e.target.checked)} />
          Une personne à mobilité réduite (PMR) fait partie du groupe
        </label>
        {pmr && (
          <div className={styles.field}>
            <label htmlFor="m-acc">Places accompagnant juste à côté</label>
            <select id="m-acc" value={accompagnants} onChange={(e) => setAccompagnants(Number(e.target.value))}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n} disabled={n > maxAccompagnants}>
                  {n === 0 ? 'Non, pas besoin' : `Oui, ${n} place${n > 1 ? 's' : ''}`}
                  {n > maxAccompagnants ? ` — il faut au moins ${n + 1} places` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor="m-notes">Commentaire (facultatif)</label>
        <textarea id="m-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {ok && (
        <p className={styles.confirmation} role="status">
          Demande mise à jour ✓
        </p>
      )}
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}

      <button type="button" className={styles.submit} onClick={enregistrer} disabled={pending}>
        {pending ? 'Enregistrement…' : 'Enregistrer les modifications'}
      </button>
      <button type="button" className={styles.annuler} onClick={annuler} disabled={pending}>
        Annuler ma demande
      </button>
    </div>
  )
}
