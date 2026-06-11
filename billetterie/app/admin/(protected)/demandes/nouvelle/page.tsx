// /admin/demandes/nouvelle — créer une demande depuis le back-office.
// Représentations OUVERTES avec jauge restante affichée (la création échoue
// proprement si la jauge est insuffisante au moment de la soumission).

import type { Metadata } from 'next'
import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { representationsOuvertes } from '@/lib/jauge'

import NouvelleDemandeForm, { type RepresentationOption } from './nouvelle-form'
import styles from './nouvelle.module.css'

export const metadata: Metadata = { title: 'Nouvelle demande — Billetterie admin' }

const formatDate = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

export default async function NouvelleDemandePage() {
  await requireAdmin()

  const ouvertes = await representationsOuvertes(prisma)
  const representations: RepresentationOption[] = ouvertes.map((rep) => ({
    id: rep.id,
    label: `${rep.title} — ${formatDate.format(rep.startsAt)} (${rep.jauge} place${rep.jauge > 1 ? 's' : ''})`,
  }))

  return (
    <main className={styles.page}>
      <div className={styles.titre}>
        <h1>Nouvelle demande</h1>
        <Link className={styles.retour} href="/admin/demandes">
          ← Retour aux demandes
        </Link>
      </div>

      {representations.length === 0 ? (
        <p className={styles.vide}>
          Aucune représentation ouverte. Ouvre une représentation dans{' '}
          <Link href="/admin/representations">la gestion des représentations</Link>.
        </p>
      ) : (
        <NouvelleDemandeForm representations={representations} />
      )}
    </main>
  )
}
