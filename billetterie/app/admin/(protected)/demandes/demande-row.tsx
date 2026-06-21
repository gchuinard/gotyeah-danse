'use client'

// Ligne de demande cliquable : un clic n'importe où (sauf sur un élément
// interactif : bouton, lien, champ, formulaire…) ouvre une popup avec le
// détail complet, l'historique et la note interne modifiable. Allège la liste
// (l'historique et la note ne sont plus inline). La popup réutilise
// ConfirmDialog (mode info) et est rendue via portal pour rester du HTML valide
// (pas de <div> enfant direct de <tr>).

import { useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { annoterAction } from './actions'
import styles from './demandes.module.css'

export type DemandeDetail = {
  id: string
  name: string
  email: string
  phone: string
  partySize: number
  statutLabel: string
  pmrCount: number
  pmrCompanions: number
  ticketMode: string
  notes: string | null
  adminNotes: string | null
  places: string | null
  reglement: string | null
  createdAt: string
  paidAt: string | null
  placedAt: string | null
  expiresAt: string | null
  retour: string
  events: { id: string; label: string; detail: string | null; adminEmail: string; date: string }[]
}

// Éléments interactifs de la ligne : un clic dessus ne doit PAS ouvrir la popup.
const INTERACTIVE = 'button, a, input, select, textarea, form, label, summary, details'

export function DemandeRow({ detail, children }: { detail: DemandeDetail; children: ReactNode }) {
  const [open, setOpen] = useState(false)

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return
    setOpen(true)
  }

  return (
    <>
      <tr
        className={styles.clickableRow}
        onClick={onRowClick}
        title="Voir le détail, l’historique et la note"
      >
        {children}
      </tr>
      {open &&
        createPortal(
          <ConfirmDialog
            open
            hideCancel
            confirmLabel="Fermer"
            title={`Demande — ${detail.name}`}
            onConfirm={() => setOpen(false)}
            onCancel={() => setOpen(false)}
            message={<DetailContent detail={detail} />}
          />,
          document.body,
        )}
    </>
  )
}

function Ligne({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.detailLigne}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValeur}>{children}</span>
    </div>
  )
}

function DetailContent({ detail }: { detail: DemandeDetail }) {
  return (
    <div className={styles.detail}>
      <div className={styles.detailGrille}>
        <Ligne label="Contact">
          {detail.email}
          <br />
          {detail.phone}
        </Ligne>
        <Ligne label="Places">{detail.partySize}</Ligne>
        <Ligne label="Statut">{detail.statutLabel}</Ligne>
        {detail.pmrCount > 0 && (
          <Ligne label="PMR">
            {detail.pmrCount} personne{detail.pmrCount > 1 ? 's' : ''}
            {detail.pmrCompanions > 0
              ? `, ${detail.pmrCompanions} accompagnant${detail.pmrCompanions > 1 ? 's' : ''} à coller`
              : ''}
          </Ligne>
        )}
        <Ligne label="Remise">
          {detail.ticketMode === 'papier' ? 'Papier (impression)' : 'E-billet (email)'}
        </Ligne>
        {detail.places && <Ligne label="Places attribuées">{detail.places}</Ligne>}
        {detail.reglement && <Ligne label="Règlement">{detail.reglement}</Ligne>}
        <Ligne label="Créée le">{detail.createdAt}</Ligne>
        {detail.paidAt && <Ligne label="Payée le">{detail.paidAt}</Ligne>}
        {detail.placedAt && <Ligne label="Placée le">{detail.placedAt}</Ligne>}
        {detail.expiresAt && <Ligne label="Échéance">{detail.expiresAt}</Ligne>}
      </div>

      {detail.notes && (
        <div className={styles.detailBloc}>
          <h3 className={styles.detailTitre}>Demande particulière (famille)</h3>
          <p className={styles.detailTexte}>{detail.notes}</p>
        </div>
      )}

      <div className={styles.detailBloc}>
        <h3 className={styles.detailTitre}>Note interne</h3>
        <form action={annoterAction} className={styles.detailNoteForm}>
          <input type="hidden" name="id" value={detail.id} />
          <input type="hidden" name="retour" value={detail.retour} />
          <input
            type="text"
            name="annotation"
            maxLength={300}
            defaultValue={detail.adminNotes ?? ''}
            placeholder="chèque n°…, PMR, contexte…"
            className={styles.detailNoteInput}
          />
          <button type="submit" className={styles.btn}>
            Enregistrer
          </button>
        </form>
      </div>

      <div className={styles.detailBloc}>
        <h3 className={styles.detailTitre}>Historique ({detail.events.length})</h3>
        {detail.events.length === 0 ? (
          <p className={styles.detailTexte}>Aucune action enregistrée.</p>
        ) : (
          <ul className={styles.detailHisto}>
            {detail.events.map((e) => (
              <li key={e.id}>
                <span className={styles.detailHistoDate}>{e.date}</span> — {e.label}
                {e.detail ? ` (${e.detail})` : ''} —{' '}
                <span className={styles.detailHistoAuteur}>{e.adminEmail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
