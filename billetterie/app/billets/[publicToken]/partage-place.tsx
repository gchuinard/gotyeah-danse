'use client'

// Partage d'UNE place depuis l'espace client (page billets, billet placé) :
// le code court « GC1234 » + Copier (le code, pour dicter) + Partager (lien
// direct /place/<qrToken> via le partage natif, ou copie du lien en repli).
// Petits toasts de confirmation. Bloc écran seulement (pas à l'impression).

import { useState } from 'react'

import styles from './billets.module.css'

type Props = {
  code: string
  qrToken: string
  rang: string
  place: number
  titre: string
}

export default function PartagePlace({ code, qrToken, rang, place, titre }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 1800)
  }

  async function copier() {
    try {
      await navigator.clipboard.writeText(code)
      flash('Code copié ✓')
    } catch {
      flash('Copie impossible sur cet appareil')
    }
  }

  async function partager() {
    const lien = `${window.location.origin}/place/${qrToken}`
    const texte =
      `Ta place pour ${titre} : rang ${rang}, place ${place}.\n` +
      `Lien direct : ${lien}\n` +
      `(ou code ${code} sur la page « Voir ma place », avec l’email de la réservation)`

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Ta place pour le spectacle', text: texte, url: lien })
      } catch {
        // Partage annulé par l'utilisateur : rien à signaler.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(texte)
      flash('Lien copié ✓')
    } catch {
      flash('Partage impossible sur cet appareil')
    }
  }

  return (
    <div className={`${styles.partage} ${styles.screenOnly}`}>
      <p className={styles.partageLabel}>
        Code de cette place : <strong className={styles.partageCode}>{code}</strong>
      </p>
      <div className={styles.partageActions}>
        <button type="button" className={styles.partageBtn} onClick={copier}>
          Copier
        </button>
        <button type="button" className={styles.partageBtn} onClick={partager}>
          Partager
        </button>
        {toast && (
          <span className={styles.partageToast} role="status">
            {toast}
          </span>
        )}
      </div>
    </div>
  )
}
