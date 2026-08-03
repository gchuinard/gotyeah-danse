'use client'

// Ligne de demande cliquable : un clic n'importe où (sauf sur un élément
// interactif) ouvre une popup LARGE qui sert de centre d'actions — détails,
// historique, note modifiable ET toutes les actions (versements, remboursement,
// placement, billets, remise, rectification, places offertes, annulation). La
// liste ne garde qu'un raccourci de placement. La popup réutilise ConfirmDialog
// (mode info, large) et est rendue via portal (HTML valide : pas de <div>
// enfant de <tr>).

import { useActionState, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { euros, placesPayantes, resumePaiement } from '@/lib/admin/money'
import {
  MOTIF_AUTRE,
  MOTIF_PLACES_RETIREES,
  MOTIF_PLACES_RETIREES_SEP,
  REFUND_MOTIFS,
} from '@/lib/admin/refund-motifs'
import { MAX_PARTY_SIZE } from '@/lib/public/limits'
import { ConfirmSubmit } from './confirm-submit'
import {
  ajouterPaiementAction,
  annoterAction,
  annulerAction,
  annulerPaiementAction,
  basculerRemiseAction,
  definirNombreEnfantsAction,
  definirPlacesOffertesAction,
  prolongerAction,
  rectifierPlacesAction,
  rembourserAction,
  renvoyerBilletsAction,
  supprimerPaiementAction,
  type ActionState,
} from './actions'
import styles from './demandes.module.css'

export type PaymentRow = {
  id: string
  method: string // especes | cheque | autre
  amountCents: number
  depositOnText: string | null // date de dépôt prévue (chèque échelonné), formatée
  reference: string | null
}

export type DemandeDetail = {
  id: string
  name: string
  email: string
  phone: string
  partySize: number
  childCount: number
  freeSeats: number
  adultPriceCents: number | null
  childPriceCents: number | null
  status: string // brut : pending | paid | placed | cancelled | expired
  statutLabel: string
  // Demande d'une représentation ARCHIVÉE : popup en lecture seule (aucune
  // action rendue). Le serveur les refuserait de toute façon — c'est une
  // double sécurité, pas la seule (cf. lib/admin/archive.ts).
  figee: boolean
  expiree: boolean
  paid: boolean
  pmrCount: number
  pmrCompanions: number
  ticketMode: string
  publicToken: string
  payments: PaymentRow[]
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

const METHODES: Record<string, string> = { especes: 'Espèces', cheque: 'Chèque', autre: 'Autre' }

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

// Motif de remboursement : motifs courants en menu déroulant + « Autre… » qui
// révèle un champ libre. Pour « Place(s) retirée(s) », un champ NOMBRE apparaît
// (le serveur enregistre « Place(s) retirée(s) : N »). Le serveur
// (rembourserAction) lit `raison`, `placesRetirees` ou `raisonAutre`.
function MotifRemboursement({ initial }: { initial: string | null }) {
  const presets = REFUND_MOTIFS as readonly string[]
  const prefixPlaces = `${MOTIF_PLACES_RETIREES}${MOTIF_PLACES_RETIREES_SEP}`
  // Restitue le motif + le nombre depuis un refundReason déjà enregistré.
  let initChoix: string = presets[0]
  let initCount = ''
  if (initial) {
    if (initial.startsWith(prefixPlaces)) {
      initChoix = MOTIF_PLACES_RETIREES
      initCount = initial.slice(prefixPlaces.length).replace(/\D/g, '')
    } else if (presets.includes(initial)) {
      initChoix = initial
    } else {
      initChoix = MOTIF_AUTRE
    }
  }
  const [choix, setChoix] = useState(initChoix)
  const [count, setCount] = useState(initCount)
  return (
    <>
      <select
        name="raison"
        value={choix}
        onChange={(e) => setChoix(e.target.value)}
        aria-label="Motif du remboursement"
      >
        {REFUND_MOTIFS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={MOTIF_AUTRE}>Autre…</option>
      </select>
      {choix === MOTIF_PLACES_RETIREES && (
        <input
          type="number"
          name="placesRetirees"
          min={1}
          max={MAX_PARTY_SIZE}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="nb places"
          aria-label="Nombre de places retirées"
        />
      )}
      {choix === MOTIF_AUTRE && (
        <input
          type="text"
          name="raisonAutre"
          maxLength={200}
          placeholder="préciser le motif"
          aria-label="Autre motif"
          defaultValue={initial && !presets.includes(initial) && !initial.startsWith(prefixPlaces) ? initial : ''}
        />
      )}
    </>
  )
}

// Formulaire générique d'action de la popup : useActionState → la POPUP RESTE
// OUVERTE (feedback inline, pas de navigation), revalidatePath rafraîchit les
// données affichées. `children(pending)` rend les champs/boutons.
function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>
  children: (pending: boolean) => ReactNode
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState)
  return (
    <form action={formAction} className={className ?? styles.detailActionForm}>
      {children(pending)}
      {state.error && <p className={styles.detailWarn}>{state.error}</p>}
      {state.ok && <p className={styles.detailOk}>{state.ok}</p>}
    </form>
  )
}

// Date du jour au format AAAA-MM-JJ (heure LOCALE = fuseau de l'admin, Paris).
function dateAujourdHui(): string {
  const d = new Date()
  const deux = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`
}

// « Ajouter un versement ». Remonté par sa `key` (= nb de versements, cf.
// SectionPaiement) après chaque ajout réussi → champs vidés et montant
// pré-rempli au nouveau reste dû. Champ « Date de paiement » pré-rempli au jour
// (modifiable si dépôt différé). Pas de n° de chèque.
function AjouterVersementForm({
  detail,
  presetMontant,
}: {
  detail: DemandeDetail
  presetMontant: string
}) {
  // Date du jour figée à l'ouverture du formulaire (remonté à chaque ajout).
  const [dateVersement] = useState(dateAujourdHui)
  return (
    <ActionForm action={ajouterPaiementAction}>
      {(pending) => (
        <>
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
            aria-label="Montant du versement en euros"
            defaultValue={presetMontant}
          />
          <label className={styles.detailInline}>
            Date de paiement
            <input
              type="date"
              name="depositOn"
              defaultValue={dateVersement}
              aria-label="Date de paiement"
              title="Date du paiement (dépôt pour un chèque) — pré-remplie au jour, modifiable"
            />
          </label>
          <button type="submit" className={styles.btn} disabled={pending}>
            {pending ? 'Enregistrement…' : 'Ajouter le versement'}
          </button>
        </>
      )}
    </ActionForm>
  )
}

function SectionPaiement({ detail }: { detail: DemandeDetail }) {
  const r = resumePaiement({
    partySize: detail.partySize,
    childCount: detail.childCount,
    freeSeats: detail.freeSeats,
    adultPriceCents: detail.adultPriceCents,
    childPriceCents: detail.childPriceCents,
    payments: detail.payments,
    refundCents: detail.refundCents,
  })
  const { adultes, enfants } = placesPayantes(detail.partySize, detail.childCount, detail.freeSeats)
  // Ventilation lisible du dû : « 3 ad. × 12 € + 2 enf. × 6 € ».
  const ventil = [
    adultes > 0 && detail.adultPriceCents != null
      ? `${adultes} ad. × ${euros(detail.adultPriceCents)}`
      : null,
    enfants > 0 && detail.childPriceCents != null
      ? `${enfants} enf. × ${euros(detail.childPriceCents)}`
      : null,
  ]
    .filter(Boolean)
    .join(' + ')
  // Montant pré-rempli du prochain versement = reste dû (s'il est connu et > 0).
  const presetMontant =
    r.resteCents != null && r.resteCents > 0 ? (r.resteCents / 100).toFixed(2).replace('.', ',') : ''

  return (
    <div className={styles.detailBloc}>
      <h3 className={styles.detailTitre}>Paiement</h3>

      {detail.placesChangedAfterPayment && (
        <p className={styles.detailWarn}>
          Le nombre de places a changé après le paiement : vérifiez le montant dû et enregistrez un
          remboursement si besoin.
        </p>
      )}

      {/* Récap dû / reçu / reste */}
      <p className={styles.montantRecap}>
        {r.duCents != null ? (
          <>
            Montant dû : <strong>{euros(r.duCents)}</strong>{' '}
            <span className={styles.versementMeta}>
              ({ventil || 'tout offert'}
              {detail.freeSeats > 0
                ? `, ${detail.freeSeats} offerte${detail.freeSeats > 1 ? 's' : ''}`
                : ''}
              )
            </span>
            <br />
          </>
        ) : (
          <span className={styles.versementMeta}>
            Tarif non défini — montant dû indisponible.
            <br />
          </span>
        )}
        Reçu : <strong>{euros(r.remisCents)}</strong>
        {r.rembourseCents > 0 && (
          <>
            {' · '}remboursé {euros(r.rembourseCents)} → net <strong>{euros(r.netCents)}</strong>
          </>
        )}
        {r.duCents != null && (
          <>
            {' · '}
            {r.resteCents && r.resteCents > 0 ? (
              <span className={styles.resteDu}>reste {euros(r.resteCents)}</span>
            ) : r.tropPercuCents > 0 ? (
              <span className={styles.resteDu}>trop-perçu {euros(r.tropPercuCents)}</span>
            ) : (
              <span className={styles.soldeOk}>soldé ✓</span>
            )}
          </>
        )}
      </p>

      {/* Versements enregistrés */}
      {detail.payments.length > 0 && (
        <ul className={styles.versementListe}>
          {detail.payments.map((p) => (
            <li key={p.id} className={styles.versementLigne}>
              <span className={styles.versementMontant}>{euros(p.amountCents)}</span>
              <span className={styles.versementMeta}>
                {METHODES[p.method] ?? p.method}
                {p.depositOnText ? ` · dépôt ${p.depositOnText}` : ''}
                {p.reference ? ` · ${p.reference}` : ''}
              </span>
              <ActionForm action={supprimerPaiementAction} className={styles.versementSuppr}>
                {() => (
                  <>
                    <Hidden detail={detail} />
                    <input type="hidden" name="paymentId" value={p.id} />
                    <ConfirmSubmit
                      className={styles.btn}
                      message={`Supprimer ce versement de ${euros(p.amountCents)} ?`}
                    >
                      Supprimer
                    </ConfirmSubmit>
                  </>
                )}
              </ActionForm>
            </li>
          ))}
        </ul>
      )}

      {/* Ajouter un versement : la popup RESTE OUVERTE (useActionState, pas de
          redirect) → on enchaîne plusieurs chèques sans rouvrir la demande. La
          clé = nb de versements : remonte le form (champs vidés, reste recalculé)
          après chaque ajout réussi. */}
      {detail.expiree && !detail.paid ? (
        <p className={styles.detailTexte}>Demande expirée — prolongez-la avant d’encaisser.</p>
      ) : (
        <AjouterVersementForm
          key={detail.payments.length}
          detail={detail}
          presetMontant={presetMontant}
        />
      )}

      {/* Annuler TOUT le règlement */}
      {detail.paid && (
        <ActionForm action={annulerPaiementAction}>
          {() => (
            <>
              <Hidden detail={detail} />
              <ConfirmSubmit
                className={styles.btn}
                message={`Annuler tout le règlement de ${detail.name} ? Tous les versements et le remboursement éventuel seront supprimés.`}
              >
                Annuler tout le règlement
              </ConfirmSubmit>
            </>
          )}
        </ActionForm>
      )}
    </div>
  )
}

// Remboursement : BLOC SÉPARÉ du paiement (ex. places retirées après règlement).
// N'apparaît que si de l'argent a été reçu. La caisse compte le net = reçu −
// remboursé.
function SectionRemboursement({ detail }: { detail: DemandeDetail }) {
  const r = resumePaiement({
    partySize: detail.partySize,
    childCount: detail.childCount,
    freeSeats: detail.freeSeats,
    adultPriceCents: detail.adultPriceCents,
    childPriceCents: detail.childPriceCents,
    payments: detail.payments,
    refundCents: detail.refundCents,
  })
  if (r.remisCents <= 0) return null
  return (
    <div className={styles.detailBloc}>
      <h3 className={styles.detailTitre}>Remboursement</h3>
      {detail.refundCents ? (
        <p className={styles.detailTexte}>
          Remboursé : <strong>{euros(detail.refundCents)}</strong>
          {detail.refundReason ? ` — ${detail.refundReason}` : ''} → net en caisse{' '}
          {euros(r.netCents)}.
        </p>
      ) : (
        <p className={styles.detailTexte}>
          Aucun remboursement. À utiliser p. ex. après le retrait de places déjà réglées.
        </p>
      )}
      <ActionForm action={rembourserAction}>
        {() => (
          <>
            <Hidden detail={detail} />
            <input
              type="text"
              name="montant"
              inputMode="decimal"
              placeholder="€ remboursés"
              aria-label="Montant remboursé en euros"
              defaultValue={detail.refundCents ? (detail.refundCents / 100).toFixed(2).replace('.', ',') : ''}
            />
            <MotifRemboursement initial={detail.refundReason} />
            <button type="submit" className={styles.btn}>
              Enregistrer le remboursement
            </button>
          </>
        )}
      </ActionForm>
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
            <ActionForm action={renvoyerBilletsAction}>
              {() => (
                <>
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
                </>
              )}
            </ActionForm>
          ))}

        <ActionForm action={basculerRemiseAction}>
          {() => (
            <>
              <Hidden detail={detail} />
              <button type="submit" className={styles.btn}>
                {detail.ticketMode === 'papier' ? '📧 Passer en e-billet' : '🖨️ Passer en papier'}
              </button>
            </>
          )}
        </ActionForm>

        {detail.status === 'pending' && (
          <ActionForm action={prolongerAction}>
            {() => (
              <>
                <Hidden detail={detail} />
                <button type="submit" className={styles.btn}>
                  Prolonger (+14 j)
                </button>
              </>
            )}
          </ActionForm>
        )}
      </div>

      <ActionForm action={rectifierPlacesAction}>
        {() => (
          <>
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
          </>
        )}
      </ActionForm>

      <ActionForm action={definirNombreEnfantsAction}>
        {() => (
          <>
            <Hidden detail={detail} />
            <label className={styles.detailInline}>
              Dont enfants (tarif réduit)
              <input
                type="number"
                name="childCount"
                min={0}
                max={detail.partySize}
                defaultValue={detail.childCount}
                aria-label="Nombre d'enfants"
              />
            </label>
            <button type="submit" className={styles.btn}>
              Enregistrer
            </button>
          </>
        )}
      </ActionForm>

      <ActionForm action={definirPlacesOffertesAction}>
        {() => (
          <>
            <Hidden detail={detail} />
            <label className={styles.detailInline}>
              Places offertes (gratuites)
              <input
                type="number"
                name="freeSeats"
                min={0}
                max={detail.partySize}
                defaultValue={detail.freeSeats}
                aria-label="Places offertes"
              />
            </label>
            <button type="submit" className={styles.btn}>
              Enregistrer
            </button>
          </>
        )}
      </ActionForm>

      <ActionForm action={annulerAction}>
        {() => (
          <>
            <Hidden detail={detail} />
            <ConfirmSubmit
              className={styles.btnDanger}
              message={`Annuler la demande de ${detail.name} (${detail.partySize} place(s)) ? Les billets éventuels seront invalidés.${
                detail.paid
                  ? ' Les versements enregistrés seront retirés de la caisse — gère le remboursement à la famille séparément.'
                  : ''
              }`}
            >
              Annuler la demande
            </ConfirmSubmit>
          </>
        )}
      </ActionForm>
    </div>
  )
}

function DetailContent({ detail }: { detail: DemandeDetail }) {
  // Une demande gelée (représentation archivée) reste entièrement CONSULTABLE —
  // détail, places attribuées, historique — mais ne rend aucun formulaire.
  const actionable = !detail.figee && ['pending', 'paid', 'placed'].includes(detail.status)
  return (
    <div className={styles.detail}>
      <div className={styles.detailGrille}>
        <Ligne label="Contact">
          {detail.email}
          <br />
          {detail.phone}
        </Ligne>
        <Ligne label="Places">
          {detail.partySize}
          {detail.childCount > 0
            ? ` (${detail.partySize - detail.childCount} adulte${detail.partySize - detail.childCount > 1 ? 's' : ''}, ${detail.childCount} enfant${detail.childCount > 1 ? 's' : ''})`
            : ''}
          {detail.freeSeats > 0
            ? ` — dont ${detail.freeSeats} offerte${detail.freeSeats > 1 ? 's' : ''}`
            : ''}
        </Ligne>
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

      {detail.figee && (
        <p className={styles.detailWarn}>
          Représentation archivée : cette demande est <strong>gelée</strong>{' '}(lecture seule).
          Désarchive la représentation pour pouvoir la modifier.
        </p>
      )}

      {actionable && <SectionPaiement detail={detail} />}
      {actionable && <SectionRemboursement detail={detail} />}
      {actionable && <SectionGestion detail={detail} />}

      <div className={styles.detailBloc}>
        <h3 className={styles.detailTitre}>Note interne</h3>
        {detail.figee ? (
          <p className={styles.detailTexte}>{detail.adminNotes || 'Aucune note.'}</p>
        ) : (
          <ActionForm action={annoterAction} className={styles.detailNoteForm}>
            {() => (
              <>
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
              </>
            )}
          </ActionForm>
        )}
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
