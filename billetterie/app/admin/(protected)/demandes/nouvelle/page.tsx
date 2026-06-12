// /admin/demandes/nouvelle — créer une demande depuis le back-office.
// Représentations OUVERTES avec jauge restante affichée (la création échoue
// proprement si la jauge est insuffisante au moment de la soumission).

import type { Metadata } from 'next'
import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { representationsOuvertes } from '@/lib/jauge'

import NouvelleDemandeForm from './nouvelle-form'
import styles from './nouvelle.module.css'

export const metadata: Metadata = { title: 'Nouvelle demande — Billetterie admin' }

export default async function NouvelleDemandePage() {
  await requireAdmin()

  // Une seule représentation par an : on prend la première ouverte.
  const ouvertes = await representationsOuvertes(prisma)
  const representationId = ouvertes[0]?.id ?? null

  return (
    <main className={styles.page}>
      <div className={styles.titre}>
        <h1>Nouvelle demande</h1>
        <Link className={styles.retour} href="/admin/demandes">
          ← Retour aux demandes
        </Link>
      </div>

      {representationId === null ? (
        <p className={styles.vide}>
          Aucune représentation ouverte. Ouvre une représentation dans{' '}
          <Link href="/admin/representations">la gestion des représentations</Link>.
        </p>
      ) : (
        <NouvelleDemandeForm representationId={representationId} />
      )}
    </main>
  )
}
