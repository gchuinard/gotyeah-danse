'use client'

// Édition d'une demande EN ATTENTE par le demandeur (places, PMR, commentaire,
// coordonnées) + annulation. Le token de la page fait office de clé d'accès.
// Après enregistrement : récapitulatif de CE qui a changé (avant → après).

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ConfirmDialog } from '@/components/confirm-dialog'
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

type Snapshot = {
  name: string
  phone: string
  partySize: number
  pmr: boolean
  pmrCompanions: number
  notes: string
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
  const [changements, setChangements] = useState<string[] | null>(null)
  const [recapOuvert, setRecapOuvert] = useState(false)
  const [confirmAnnulation, setConfirmAnnulation] = useState(false)

  // Valeurs de référence pour le « avant → après » (mises à jour à chaque save).
  const reference = useRef<Snapshot>({
    name: props.name,
    phone: props.phone,
    partySize: props.partySize,
    pmr: props.pmr,
    pmrCompanions: props.pmrCompanions,
    notes: props.notes,
  })

  const plafond = Math.min(MAX_PARTY_SIZE, Math.max(1, props.maxPlaces))
  const places = Array.from({ length: plafond }, (_, i) => i + 1)
  const maxAccompagnants = Math.min(3, partySize - 1)

  const enregistrer = async () => {
    setPending(true)
    setError(null)
    setChangements(null)
    const apres: Snapshot = {
      name: name.trim(),
      phone,
      partySize,
      pmr,
      pmrCompanions: pmr ? Math.min(accompagnants, partySize - 1) : 0,
      notes: notes.trim(),
    }
    const res = await modifierDemande({
      token: props.token,
      name: apres.name,
      phone: apres.phone,
      partySize: apres.partySize,
      notes: apres.notes || undefined,
      pmr: apres.pmr,
      pmrCompanions: apres.pmrCompanions,
    })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }

    // Diff lisible avant → après.
    const av = reference.current
    const lignes: string[] = []
    if (av.name !== apres.name) lignes.push(`Nom : « ${av.name} » → « ${apres.name} »`)
    if (av.phone !== apres.phone) lignes.push(`Téléphone : « ${av.phone} » → « ${apres.phone} »`)
    if (av.partySize !== apres.partySize)
      lignes.push(`Nombre de places : ${av.partySize} → ${apres.partySize}`)
    if (av.pmr !== apres.pmr) lignes.push(`PMR : ${av.pmr ? 'oui' : 'non'} → ${apres.pmr ? 'oui' : 'non'}`)
    if (av.pmrCompanions !== apres.pmrCompanions)
      lignes.push(`Accompagnant : ${av.pmrCompanions} → ${apres.pmrCompanions} place(s)`)
    if (av.notes !== apres.notes)
      lignes.push(`Commentaire : « ${av.notes || '—'} » → « ${apres.notes || '—'} »`)

    reference.current = apres
    setChangements(lignes)
    setRecapOuvert(true)
    router.refresh()
  }

  const annuler = async () => {
    setConfirmAnnulation(false)
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

      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}

      <button type="button" className={styles.submit} onClick={enregistrer} disabled={pending}>
        {pending ? 'Enregistrement…' : 'Enregistrer les modifications'}
      </button>
      <button
        type="button"
        className={styles.annuler}
        onClick={() => setConfirmAnnulation(true)}
        disabled={pending}
      >
        Annuler ma demande
      </button>

      <ConfirmDialog
        open={confirmAnnulation}
        title="Annuler la demande"
        message="Annuler définitivement votre demande de places ? Cette action est irréversible."
        confirmLabel="Oui, annuler"
        cancelLabel="Revenir"
        danger
        onCancel={() => setConfirmAnnulation(false)}
        onConfirm={annuler}
      />

      {/* Récap des modifications, en popup. */}
      <ConfirmDialog
        open={recapOuvert}
        hideCancel
        confirmLabel="Fermer"
        title={changements && changements.length > 0 ? 'Demande mise à jour ✓' : 'Aucune modification'}
        message={
          changements && changements.length > 0 ? (
            <>
              <p style={{ margin: '0 0 0.5rem' }}>Voici ce qui a changé :</p>
              <ul className={styles.diff}>
                {changements.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          ) : (
            'Aucun champ n’a été modifié.'
          )
        }
        onCancel={() => setRecapOuvert(false)}
        onConfirm={() => setRecapOuvert(false)}
      />
    </div>
  )
}
