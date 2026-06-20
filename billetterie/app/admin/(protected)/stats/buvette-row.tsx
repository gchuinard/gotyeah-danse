'use client'

// Ligne d'article buvette, éditable À LA VOLÉE :
//  - inputs contrôlés ; recette et balance se recalculent à chaque frappe,
//    100 % côté client, via les mêmes fonctions pures que le serveur ;
//  - pas de bouton « OK » : la ligne s'enregistre toute seule — sauvegarde
//    debouncée pendant la frappe + immédiate quand un champ perd le focus
//    (requestSubmit déclenche l'action serveur, qui revalide sans rediriger) ;
//  - suppression via une confirmation.

import { useCallback, useEffect, useRef, useState } from 'react'

import { balanceLigneCents, recetteLigneCents } from '@/lib/admin/buvette'

import { modifierBuvetteAction, supprimerBuvetteAction } from './actions'
import { ConfirmDeleteButton } from './confirm-delete'
import styles from './stats.module.css'

type Item = {
  id: string
  label: string
  qtyStock: number
  qtySold: number
  unitPriceCents: number
  purchasePriceCents: number
}

const SAVE_DEBOUNCE_MS = 700

// Centimes → champ en euros (sans forcer 2 décimales, pour éditer librement).
function centsToInput(cents: number): string {
  return (cents / 100).toString()
}

// Champ euros (« 2,5 » ou « 2.5 ») → centimes ; vide/invalide → 0.
function inputToCents(s: string): number {
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

function toQty(s: string): number {
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}

export function BuvetteRow({ item, repId }: { item: Item; repId: string }) {
  const [label, setLabel] = useState(item.label)
  const [achat, setAchat] = useState(String(item.qtyStock))
  const [prixAchat, setPrixAchat] = useState(centsToInput(item.purchasePriceCents))
  const [vendu, setVendu] = useState(String(item.qtySold))
  const [prixVente, setPrixVente] = useState(centsToInput(item.unitPriceCents))

  const formRef = useRef<HTMLFormElement>(null)
  const timerRef = useRef<number | null>(null)
  const dirtyRef = useRef(false)

  const submit = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!dirtyRef.current) return
    dirtyRef.current = false
    formRef.current?.requestSubmit()
  }, [])

  // Appelé à chaque modif : marque la ligne « sale » et programme l'envoi.
  const onEdit = useCallback(() => {
    dirtyRef.current = true
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(submit, SAVE_DEBOUNCE_MS)
  }, [submit])

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  // Calcul à la volée, via les mêmes fonctions pures que le serveur.
  const ligne = {
    qtyStock: toQty(achat),
    qtySold: toQty(vendu),
    unitPriceCents: inputToCents(prixVente),
    purchasePriceCents: inputToCents(prixAchat),
  }
  const recetteCents = recetteLigneCents(ligne)
  const balanceCents = balanceLigneCents(ligne)

  return (
    <form ref={formRef} action={modifierBuvetteAction} className={styles.buvetteLigne} onBlur={submit}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="repId" value={repId} />
      <input
        name="label"
        value={label}
        onChange={(e) => {
          setLabel(e.target.value)
          onEdit()
        }}
        maxLength={60}
        aria-label="Article"
      />
      <input
        name="qtyStock"
        type="number"
        min={0}
        value={achat}
        onChange={(e) => {
          setAchat(e.target.value)
          onEdit()
        }}
        aria-label="Quantité achetée"
      />
      <span className={styles.buvettePrix}>
        <input
          name="prixAchat"
          inputMode="decimal"
          value={prixAchat}
          onChange={(e) => {
            setPrixAchat(e.target.value)
            onEdit()
          }}
          aria-label="Prix d'achat en euros"
        />
        <span aria-hidden="true">€</span>
      </span>
      <input
        name="qtySold"
        type="number"
        min={0}
        value={vendu}
        onChange={(e) => {
          setVendu(e.target.value)
          onEdit()
        }}
        aria-label="Quantité vendue"
      />
      <span className={styles.buvettePrix}>
        <input
          name="prix"
          inputMode="decimal"
          value={prixVente}
          onChange={(e) => {
            setPrixVente(e.target.value)
            onEdit()
          }}
          aria-label="Prix de vente en euros"
        />
        <span aria-hidden="true">€</span>
      </span>
      <span className={styles.buvetteCalc}>{formatEuros(recetteCents)}</span>
      <span className={`${styles.buvetteCalc} ${balanceCents < 0 ? styles.buvetteNeg : ''}`}>
        {formatEuros(balanceCents)}
      </span>
      <span className={styles.buvetteActions}>
        <ConfirmDeleteButton
          formAction={supprimerBuvetteAction}
          message={`Supprimer « ${label} » de la buvette ? C'est définitif.`}
          className={styles.btnMiniDanger}
          title="Supprimer cet article"
          ariaLabel="Supprimer"
        >
          ✕
        </ConfirmDeleteButton>
      </span>
    </form>
  )
}
