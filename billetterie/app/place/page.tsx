// /place — vue publique « voir une place partagée ». Une famille a partagé un
// code de place (« GC1234 ») à une copine : avec l'email de la réservation + ce
// code, elle affiche SON siège (rang, place, QR) en lecture seule. Aucune donnée
// perso, aucune action. Le formulaire et son rendu vivent dans place-form.tsx.

import type { Metadata } from 'next'

import PlaceForm from './place-form'
import styles from './place.module.css'

export const metadata: Metadata = {
  title: 'Voir ma place — Billetterie',
}

export default function PlacePage() {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <p className={styles.kicker}>Billetterie du spectacle</p>
          <h1 className={styles.title}>Voir ma place</h1>
          <p className={styles.text}>
            Une place vous a été partagée ? Entrez l’email de la réservation et le code de la place
            (ex. «&nbsp;GC1234&nbsp;») pour afficher votre siège et son QR code.
          </p>
        </header>
        <PlaceForm />
      </div>
    </main>
  )
}
