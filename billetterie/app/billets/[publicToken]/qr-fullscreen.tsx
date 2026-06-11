'use client'

// QR « billet dans le téléphone » : un tap sur le QR l'affiche en plein
// écran, fond blanc, taille max — se scanne beaucoup mieux à l'entrée
// (luminosité, distance, reflets). Tap n'importe où pour fermer.

import { useCallback, useEffect, useState } from 'react'

import styles from './billets.module.css'

type Props = {
  src: string
  rang: string
  place: number
  titre: string
}

export default function QrFullscreen({ src, rang, place, titre }: Props) {
  const [open, setOpen] = useState(false)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, close])

  return (
    <>
      <button
        type="button"
        className={styles.qrButton}
        onClick={() => setOpen(true)}
        aria-label={`Afficher le QR code en plein écran — rang ${rang} place ${place}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.qr} src={src} alt="QR code du billet" width={180} height={180} />
        <span className={styles.qrHint}>Toucher pour agrandir</span>
      </button>

      {open && (
        <div
          className={styles.qrOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="QR code en plein écran"
          onClick={close}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.qrLarge} src={src} alt="QR code du billet" />
          <p className={styles.qrOverlaySeat}>
            {titre} — Rang {rang} · Place {place}
          </p>
          <p className={styles.qrOverlayHint}>Montez la luminosité · Toucher pour fermer</p>
        </div>
      )}
    </>
  )
}
