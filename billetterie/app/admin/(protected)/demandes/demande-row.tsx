'use client'

// Ligne de demande cliquable : un clic n'importe où (sauf sur un élément
// interactif) ouvre une popup LARGE qui sert de centre d'actions — détails,
// historique, note modifiable ET toutes les actions (paiement, remboursement,
// placement, billets, remise, rectification, annulation). La liste ne garde
// qu'un raccourci de placement. La popup réutilise ConfirmDialog (mode info,
// large) et est rendue via portal (HTML valide : pas de <div> enfant de <tr>).

import { useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { MAX_PARTY_SIZE } from '@/lib/public/limits'
import { ConfirmSubmit } from './confirm-submit'
import {
  annoterAction,
  annulerAction,
  annulerPaiementAction,
  basculerRemiseAction,
  marquerPayeeAction,
  prolongerAction,
  rectifierPlacesAction,
  rembourserAction,
  renvoyerBilletsAction,
} from './actions'
import styles from './demandes.module.css'

export type DemandeDetail = {
  id: string
  name: string
  email: string
  phone: string
  partySize: number
  status: string // brut : pending | paid | placed | cancelled | expired
  statutLabel: string
  expiree: boolean
  paid: boolean
  pmrCount: number
  pmrCompanions: number
  ticketMode: string
  publicToken: string
  paymentMethodLabel: string | null
  amountCents: number | null
  refundCents: number | null
  refundReason: string | null
  placesChangedAfterPayment: boolean
  notes: string | null
  adminNotes: string | null
  places: string | null
  createdAt: string
  paidAt: string | null
  placedAt: string | null
  expiresAt: string | null
  retour: string
  events: { id: string; label: string; detail: string | null; adminEmail: string; date: string }[]
}

// Éléments interactifs de la ligne : un clic dessus ne doit PAS ouvrir la popup.
const INTERACTIVE = 'button, a, input, select, textarea, form, label, summary, details'

const eur = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`

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
        title="Voir le détail et gérer cette demande"
      >
        {children}
      </tr>
      {open &&
        createPortal(
          <ConfirmDialog
            open
            wide
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

// Champs cachés communs à toutes les actions (id + filtres de retour).
function Hidden({ detail }: { detail: DemandeDetail }) {
  return (
    <>
      <input type="hidden" name="id" value={detail.id} />
      <input type="hidden" name="retour" value={detail.retour} />
    </>
  )
}

function SectionPaiement({ detail }: { detail: DemandeDetail }) {
  const net =
    detail.amountCents != null ? detail.amountCents - (detail.refundCents ?? 0) : null
  return (
    <div className={styles.detailBloc}>
      <h3 className={styles.detailTitre}>Paiement</h3>

      {detail.placesChangedAfterPayment && (
        <p className={styles.detailWarn}>
          Le nombre de places a changé après le paiement : vérifiez le montant encaissé et
          enregistrez un remboursement si besoin.
        </p>
      )}

      {!detail.paid ? (
        detail.expiree ? (
          <p className={styles.detailTexte}>Demande expirée — prolongez-la avant de l’encaisser.</p>
        ) : (
          <form action={marquerPayeeAction} className={styles.detailActionForm}>
            <Hidden detail={detail} />
            <select name="methode" aria-label="Mode de règlement" defaultValue="cheque">
              <option value="cheque">Chèque</option>
              <option value="especes">Espèces</option>
              <option value="autre">Autre</option>
            </select>
            <input
              type="text"
              name="montant"
              inputMode="decimal"
              placeholder="€"
              aria-label="Montant encaissé en euros"
            />
            <button type="submit" className={styles.btn}>
              Marquer payée
            </button>
          </form>
        )
      ) : (
        <>
          <p className={styles.detailTexte}>
            {detail.paymentMethodLabel ?? 'Réglée'}
            {detail.amountCents != null ? ` · encaissé ${eur(detail.amountCents)}` : ' · sans montant'}
            {detail.refundCents
              ? ` · remboursé ${eur(detail.refundCents)} → net ${eur(net ?? 0)}`
              : ''}
          </p>

          {detail.amountCents != null && (
            <form action={rembourserAction} className={styles.detailActionForm}>
              <Hidden detail={detail} />
              <input
                type="text"
                name="montant"
                inputMode="decimal"
                placeholder="€ remboursés"
                aria-label="Montant remboursé en euros"
                defaultValue={detail.refundCents ? eur(detail.refundCents).replace(' €', '') : ''}
              />
              <input
                type="text"
                name="raison"
                maxLength={200}
                placeholder="motif (place retirée…)"
                aria-label="Motif du remboursement"
                defaultValue={detail.refundReason ?? ''}
              />
              <button type="submit" className={styles.btn}>
                Enregistrer le remboursement
              </button>
            </form>
          )}

          <form action={annulerPaiementAction} className={styles.detailActionForm}>
            <Hidden detail={detail} />
            <ConfirmSubmit
              className={styles.btn}
              message={`Annuler le règlement de ${detail.name} ? (le remboursement éventuel est aussi effacé)`}
            >
              Annuler le règlement
            </ConfirmSubmit>
          </form>
        </>
      )}
    </div>
  )
}

function SectionGestion({ detail }: { detail: DemandeDetail }) {
  const urlBase = `/admin/placement/${detail.id}`
  const retourQs = detail.retour ? `retour=${encodeURIComponent(detail.retour)}` : ''
  const urlPlacer = retourQs ? `${urlBase}?${retourQs}` : urlBase
  const urlDeplacer = `${urlBase}?mode=deplacer${retourQs ? `&${retourQs}` : ''}`

  return (
    <div className={styles.detailBloc}>
      <h3 className={styles.detailTitre}>Gestion</h3>
      <div className={styles.detailActions}>
        {(detail.status === 'pending' || detail.status === 'paid') && !detail.expiree && (
          <Link className={styles.btnLien} href={urlPlacer}>
            Placer
          </Link>
        )}
        {detail.status === 'placed' && (
          <Link className={styles.btnLien} href={urlDeplacer}>
            Déplacer
          </Link>
        )}

        {detail.status === 'placed' &&
          (detail.ticketMode === 'papier' ? (
            <Link
              className={styles.btnLien}
              href={`/billets/${detail.publicToken}`}
              target="_blank"
              rel="noopener"
            >
              Imprimer les billets ↗
            </Link>
          ) : (
            <form action={renvoyerBilletsAction} className={styles.detailActionForm}>
              <Hidden detail={detail} />
              {detail.paid ? (
                <button type="submit" className={styles.btn}>
                  Renvoyer les billets
                </button>
              ) : (
                <ConfirmSubmit
                  className={styles.btn}
                  message={`Aucun paiement enregistré pour ${detail.name}. Envoyer quand même les billets ?`}
                >
                  Envoyer les billets
                </ConfirmSubmit>
              )}
            </form>
          ))}

        <form action={basculerRemiseAction} className={styles.detailActionForm}>
          <Hidden detail={detail} />
          <button type="submit" className={styles.btn}>
            {detail.ticketMode === 'papier' ? '📧 Passer en e-billet' : '🖨️ Passer en papier'}
          </button>
        </form>

        {detail.status === 'pending' && (
          <form action={prolongerAction} className={styles.detailActionForm}>
            <Hidden detail={detail} />
            <button type="submit" className={styles.btn}>
              Prolonger (+14 j)
            </button>
          </form>
        )}
      </div>

      <form action={rectifierPlacesAction} className={styles.detailActionForm}>
        <Hidden detail={detail} />
        <label className={styles.detailInline}>
          Rectifier le nombre de places
          <input
            type="number"
            name="places"
            min={1}
            max={MAX_PARTY_SIZE}
            defaultValue={detail.partySize}
            aria-label="Nombre de places"
          />
        </label>
        <button type="submit" className={styles.btn}>
          Rectifier
        </button>
      </form>

      <form action={annulerAction} className={styles.detailActionForm}>
        <Hidden detail={detail} />
        <ConfirmSubmit
          className={styles.btnDanger}
          message={`Annuler la demande de ${detail.name} (${detail.partySize} place(s)) ? Les billets éventuels seront invalidés.`}
        >
          Annuler la demande
        </ConfirmSubmit>
      </form>
    </div>
  )
}

function DetailContent({ detail }: { detail: DemandeDetail }) {
  const actionable = ['pending', 'paid', 'placed'].includes(detail.status)
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

      {actionable && <SectionPaiement detail={detail} />}
      {actionable && <SectionGestion detail={detail} />}

      <div className={styles.detailBloc}>
        <h3 className={styles.detailTitre}>Note interne</h3>
        <form action={annoterAction} className={styles.detailNoteForm}>
          <Hidden detail={detail} />
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
