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
  pmrCount: number
  pmrCompanions: number
  maxPlaces: number // jauge restante + places actuelles
}

type Snapshot = {
  name: string
  phone: string
  partySize: number
  pmrCount: number
  pmrCompanions: number
  notes: string
}

export default function ModifierForm(props: Props) {
  const router = useRouter()
  const [name, setName] = useState(props.name)
  // Téléphone stocké en chiffres → on l'affiche formaté dans le champ masqué.
  const [phone, setPhone] = useState(formatFrPhone(props.phone))
  const [partySize, setPartySize] = useState(props.partySize)
  const [pmr, setPmr] = useState(props.pmrCount > 0)
  const [pmrCount, setPmrCount] = useState(props.pmrCount || 1)
  const [accompagnants, setAccompagnants] = useState(props.pmrCompanions)
  const [notes, setNotes] = useState(props.notes)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changements, setChangements] = useState<string[]>([])
  const [apresEnAttente, setApresEnAttente] = useState<Snapshot | null>(null)
  const [confirmModif, setConfirmModif] = useState(false)
  const [enregistre, setEnregistre] = useState(false)
  const [confirmAnnulation, setConfirmAnnulation] = useState(false)

  // Valeurs de référence pour le « avant → après » (mises à jour à chaque save).
  const reference = useRef<Snapshot>({
    name: props.name,
    phone: formatFrPhone(props.phone),
    partySize: props.partySize,
    pmrCount: props.pmrCount,
    pmrCompanions: props.pmrCompanions,
    notes: props.notes,
  })

  const plafond = Math.min(MAX_PARTY_SIZE, Math.max(1, props.maxPlaces))
  const places = Array.from({ length: plafond }, (_, i) => i + 1)
  const maxPmr = partySize
  const maxAccompagnants = Math.min(3, partySize - pmrCount)

  // Clic « Enregistrer » → calcule le avant → après et OUVRE la popup de
  // CONFIRMATION (rien n'est encore enregistré).
  const preparer = () => {
    setError(null)
    setEnregistre(false)
    const pmrCountFinal = pmr ? Math.min(pmrCount, partySize) : 0
    const apres: Snapshot = {
      name: name.trim(),
      phone,
      partySize,
      pmrCount: pmrCountFinal,
      pmrCompanions: pmrCountFinal > 0 ? Math.min(accompagnants, partySize - pmrCountFinal) : 0,
      notes: notes.trim(),
    }
    const av = reference.current
    const lignes: string[] = []
    if (av.name !== apres.name) lignes.push(`Nom : « ${av.name} » → « ${apres.name} »`)
    if (av.phone !== apres.phone) lignes.push(`Téléphone : « ${av.phone} » → « ${apres.phone} »`)
    if (av.partySize !== apres.partySize)
      lignes.push(`Nombre de places : ${av.partySize} → ${apres.partySize}`)
    if (av.pmrCount !== apres.pmrCount)
      lignes.push(`Personnes PMR : ${av.pmrCount} → ${apres.pmrCount}`)
    if (av.pmrCompanions !== apres.pmrCompanions)
      lignes.push(`Accompagnant : ${av.pmrCompanions} → ${apres.pmrCompanions} place(s)`)
    if (av.notes !== apres.notes)
      lignes.push(`Commentaire : « ${av.notes || '—'} » → « ${apres.notes || '—'} »`)

    setChangements(lignes)
    setApresEnAttente(apres)
    setConfirmModif(true)
  }

  // Confirmation → applique réellement la modification.
  const appliquer = async () => {
    if (!apresEnAttente) return
    const apres = apresEnAttente
    setConfirmModif(false)
    setPending(true)
    setError(null)
    const res = await modifierDemande({
      token: props.token,
      name: apres.name,
      phone: apres.phone,
      partySize: apres.partySize,
      notes: apres.notes || undefined,
      pmrCount: apres.pmrCount,
      pmrCompanions: apres.pmrCompanions,
    })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    reference.current = apres
    setEnregistre(true)
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
            const newPmr = Math.min(Math.max(1, pmrCount), n)
            setPartySize(n)
            setPmrCount(newPmr)
            setAccompagnants((a) => Math.min(a, Math.max(0, n - newPmr)))
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
          <span>Une personne à mobilité réduite (PMR) fait partie du groupe</span>
        </label>
        {pmr && (
          <>
            <div className={styles.field}>
              <label htmlFor="m-pmr">Combien de personnes en fauteuil / PMR&nbsp;?</label>
              <select
                id="m-pmr"
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
              <label htmlFor="m-acc">Places accompagnant juste à côté</label>
              <select id="m-acc" value={accompagnants} onChange={(e) => setAccompagnants(Number(e.target.value))}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n} disabled={n > maxAccompagnants}>
                    {n === 0 ? 'Non, pas besoin' : `Oui, ${n} place${n > 1 ? 's' : ''}`}
                    {n > maxAccompagnants ? ` — il faut au moins ${pmrCount + n} places` : ''}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor="m-notes">Commentaire (facultatif)</label>
        <textarea id="m-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {enregistre && (
        <p className={styles.confirmation} role="status">
          Modifications enregistrées ✓
        </p>
      )}
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}

      <button type="button" className={styles.submit} onClick={preparer} disabled={pending}>
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

      {/* Popup de CONFIRMATION : montre le avant → après avant d'enregistrer. */}
      <ConfirmDialog
        open={confirmModif}
        title={changements.length > 0 ? 'Confirmer les modifications' : 'Aucune modification'}
        message={
          changements.length > 0 ? (
            <>
              <p style={{ margin: '0 0 0.5rem' }}>Vous allez modifier :</p>
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
        confirmLabel={changements.length > 0 ? 'Confirmer' : 'Fermer'}
        cancelLabel="Annuler"
        hideCancel={changements.length === 0}
        onCancel={() => setConfirmModif(false)}
        onConfirm={changements.length > 0 ? appliquer : () => setConfirmModif(false)}
      />
    </div>
  )
}
