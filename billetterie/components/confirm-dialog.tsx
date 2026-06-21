'use client'

// Boîte de confirmation aux couleurs du site (remplace window.confirm).
// Contrôlée : le parent gère `open` et les callbacks.

import { useEffect } from 'react'

import styles from './confirm-dialog.module.css'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  // Mode INFO (récap) : un seul bouton (pas de choix oui/non).
  hideCancel = false,
  // Boîte large (ex. centre d'actions d'une demande).
  wide = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title?: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  hideCancel?: boolean
  wide?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  // Échap ferme la boîte.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={wide ? `${styles.dialog} ${styles.dialogLarge}` : styles.dialog}
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className={styles.title}>{title}</h2>}
        <div className={styles.message}>{message}</div>
        <div className={styles.actions}>
          {!hideCancel && (
            <button type="button" className={styles.cancel} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={danger ? styles.danger : styles.confirm}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
