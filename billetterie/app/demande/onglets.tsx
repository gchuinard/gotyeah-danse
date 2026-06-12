'use client'

// Onglets de l'accueil : « Nouvelle demande » / « J'ai déjà une demande ».
// Les deux panneaux (server/client components) sont passés en props.

import { useState, type ReactNode } from 'react'

import styles from './onglets.module.css'

export default function Onglets({ nouvelle, acces }: { nouvelle: ReactNode; acces: ReactNode }) {
  const [actif, setActif] = useState<'nouvelle' | 'acces'>('nouvelle')

  return (
    <div>
      <div className={styles.tabs} role="tablist" aria-label="Type de demande">
        <button
          type="button"
          role="tab"
          aria-selected={actif === 'nouvelle'}
          className={actif === 'nouvelle' ? styles.tabActif : styles.tab}
          onClick={() => setActif('nouvelle')}
        >
          Nouvelle demande
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={actif === 'acces'}
          className={actif === 'acces' ? styles.tabActif : styles.tab}
          onClick={() => setActif('acces')}
        >
          J&apos;ai déjà une demande
        </button>
      </div>
      <div role="tabpanel">{actif === 'nouvelle' ? nouvelle : acces}</div>
    </div>
  )
}
