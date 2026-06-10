'use client'

// Bouton « Imprimer mes billets » — seul morceau client de la page billets.
// La vue print du CSS module fait office de PDF.

import styles from './billets.module.css'

export default function PrintButton() {
  return (
    <button type="button" className={styles.printButton} onClick={() => window.print()}>
      Imprimer mes billets
    </button>
  )
}
