'use client'

// Ligne d'article buvette, éditable à la volée :
//  - inputs contrôlés ; recette et balance se recalculent à CHAQUE FRAPPE,
//    100 % côté client (mêmes fonctions pures que le serveur) ;
//  - pas de bouton « OK » : la ligne s'enregistre quand un champ perd le focus
//    (tab, clic ailleurs, Entrée), et seulement si quelque chose a changé.
//
// On N'UTILISE PAS de <form> + requestSubmit : on appelle l'action serveur
// directement (startTransition). Enregistrer via un <form> PENDANT qu'un champ
// est encore focalisé rejouait l'ancienne valeur dans la case (revalidation +
// reset du form en conflit avec l'input contrôlé) — d'où la sauvegarde au blur.

import { useState, useTransition } from 'react'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { balanceLigneCents, recetteLigneCents } from '@/lib/admin/buvette'

import { modifierBuvetteAction, supprimerBuvetteAction } from './actions'
import styles from './stats.module.css'

type Item = {
  id: string
  label: string
  qtyStock: number
  qtySold: number
  unitPriceCents: number
  purchasePriceCents: number
}

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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [, startTransition] = useTransition()

  // Enregistrement au blur (un champ perd le focus), seulement si modifié.
  function save() {
    if (!dirty) return
    setDirty(false)
    const fd = new FormData()
    fd.set('id', item.id)
    fd.set('repId', repId)
    fd.set('label', label)
    fd.set('qtyStock', achat)
    fd.set('qtySold', vendu)
    fd.set('prix', prixVente)
    fd.set('prixAchat', prixAchat)
    startTransition(() => modifierBuvetteAction(fd))
  }

  // Entrée = valider le champ courant (déclenche le blur → save).
  function onEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  function remove() {
    setConfirmOpen(false)
    const fd = new FormData()
    fd.set('id', item.id)
    fd.set('repId', repId)
    startTransition(() => supprimerBuvetteAction(fd))
  }

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
    <>
      <div className={styles.buvetteLigne} onBlur={save}>
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value)
            setDirty(true)
          }}
          onKeyDown={onEnter}
          maxLength={60}
          aria-label="Article"
        />
        <input
          type="number"
          min={0}
          value={achat}
          onChange={(e) => {
            setAchat(e.target.value)
            setDirty(true)
          }}
          onKeyDown={onEnter}
          aria-label="Quantité achetée"
        />
        <span className={styles.buvettePrix}>
          <input
            inputMode="decimal"
            value={prixAchat}
            onChange={(e) => {
              setPrixAchat(e.target.value)
              setDirty(true)
            }}
            onKeyDown={onEnter}
            aria-label="Prix d'achat en euros"
          />
          <span aria-hidden="true">€</span>
        </span>
        <input
          type="number"
          min={0}
          value={vendu}
          onChange={(e) => {
            setVendu(e.target.value)
            setDirty(true)
          }}
          onKeyDown={onEnter}
          aria-label="Quantité vendue"
        />
        <span className={styles.buvettePrix}>
          <input
            inputMode="decimal"
            value={prixVente}
            onChange={(e) => {
              setPrixVente(e.target.value)
              setDirty(true)
            }}
            onKeyDown={onEnter}
            aria-label="Prix de vente en euros"
          />
          <span aria-hidden="true">€</span>
        </span>
        <span className={styles.buvetteCalc}>{formatEuros(recetteCents)}</span>
        <span className={`${styles.buvetteCalc} ${balanceCents < 0 ? styles.buvetteNeg : ''}`}>
          {formatEuros(balanceCents)}
        </span>
        <span className={styles.buvetteActions}>
          <button
            type="button"
            className={styles.btnMiniDanger}
            title="Supprimer cet article"
            aria-label="Supprimer"
            onClick={() => setConfirmOpen(true)}
          >
            ✕
          </button>
        </span>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Supprimer cet article ?"
        message={`Supprimer « ${label} » de la buvette ? C'est définitif.`}
        confirmLabel="Supprimer"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={remove}
      />
    </>
  )
}
