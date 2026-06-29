'use client'

// Partage d'UNE place depuis l'espace client (page billets, billet placé) :
//   - le code court « GC1234 » + Copier (le code, pour le dicter) ;
//   - Partager → petit menu de canaux EXPLICITES (WhatsApp / SMS / E-mail /
//     Copier le lien) qui marche partout, PC compris ; + le partage natif du
//     téléphone quand il est dispo (feuille système qui liste toutes les apps).
// Chaque canal envoie le LIEN DIRECT /place/<qrToken> (lecture seule, rien à
// taper). Bloc écran seulement (pas à l'impression).

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
  const [menuOuvert, setMenuOuvert] = useState(false)

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 1800)
  }

  // Lien + message bâtis au clic (origin connu côté client ; le menu n'est
  // rendu qu'après interaction, donc jamais évalué au rendu serveur).
  const lien = () => `${window.location.origin}/place/${qrToken}`
  const message = () => `Ta place pour ${titre} : rang ${rang}, place ${place}.\n${lien()}`

  async function copierCode() {
    try {
      await navigator.clipboard.writeText(code)
      flash('Code copié ✓')
    } catch {
      flash('Copie impossible sur cet appareil')
    }
  }

  async function copierLien() {
    setMenuOuvert(false)
    try {
      await navigator.clipboard.writeText(message())
      flash('Lien copié ✓')
    } catch {
      flash('Copie impossible sur cet appareil')
    }
  }

  async function partageNatif() {
    setMenuOuvert(false)
    try {
      await navigator.share({ title: 'Ta place pour le spectacle', text: message(), url: lien() })
    } catch {
      // Partage annulé par l'utilisateur : rien à signaler.
    }
  }

  const natifDispo = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <div className={`${styles.partage} ${styles.screenOnly}`}>
      <p className={styles.partageLabel}>
        Code de cette place : <strong className={styles.partageCode}>{code}</strong>
      </p>
      <div className={styles.partageActions}>
        <button type="button" className={styles.partageBtn} onClick={copierCode}>
          Copier
        </button>
        <button
          type="button"
          className={styles.partageBtn}
          aria-expanded={menuOuvert}
          onClick={() => setMenuOuvert((o) => !o)}
        >
          Partager
        </button>
        {toast && (
          <span className={styles.partageToast} role="status">
            {toast}
          </span>
        )}
      </div>

      {menuOuvert && (
        <div className={styles.partageMenu} role="menu">
          {natifDispo && (
            <button
              type="button"
              className={styles.partageMenuItem}
              role="menuitem"
              onClick={partageNatif}
            >
              Partage du téléphone…
            </button>
          )}
          <a
            className={styles.partageMenuItem}
            role="menuitem"
            href={`https://wa.me/?text=${encodeURIComponent(message())}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOuvert(false)}
          >
            WhatsApp
          </a>
          <a
            className={styles.partageMenuItem}
            role="menuitem"
            href={`sms:?&body=${encodeURIComponent(message())}`}
            onClick={() => setMenuOuvert(false)}
          >
            SMS
          </a>
          <a
            className={styles.partageMenuItem}
            role="menuitem"
            href={`mailto:?subject=${encodeURIComponent('Ta place pour le spectacle')}&body=${encodeURIComponent(message())}`}
            onClick={() => setMenuOuvert(false)}
          >
            E-mail
          </a>
          <button
            type="button"
            className={styles.partageMenuItem}
            role="menuitem"
            onClick={copierLien}
          >
            Copier le lien
          </button>
        </div>
      )}
    </div>
  )
}
