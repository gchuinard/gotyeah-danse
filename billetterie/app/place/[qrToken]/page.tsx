// /place/[qrToken] — lien DIRECT vers une place partagée. Le qrToken est déjà
// la capacité publique du billet (même jeton que /api/qr/<token>) : on affiche
// le siège + son QR en lecture seule, sans rien à taper. Jeton inconnu → 404
// (pas d'énumération, comme /billets/[publicToken]).

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { vuePlaceParQrToken } from '@/lib/booking/place'
import { prisma } from '@/lib/db'

import { formatDateHeure, sectionLabel } from '../labels'
import PlaceCard from '../place-card'
import styles from '../place.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Votre place — Billetterie',
}

export default async function PlaceDirectePage({
  params,
}: {
  params: Promise<{ qrToken: string }>
}) {
  const { qrToken } = await params
  const vue = await vuePlaceParQrToken(prisma, qrToken)
  if (!vue) notFound()

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <p className={styles.kicker}>Billetterie du spectacle</p>
          <h1 className={styles.title}>Votre place</h1>
        </header>
        <PlaceCard
          data={{
            titre: vue.repTitre,
            dateLabel: formatDateHeure(vue.repDate),
            section: sectionLabel(vue.sectionId),
            rang: vue.rang,
            place: vue.place,
            qrToken: vue.qrToken,
            proprioPrenom: vue.proprioPrenom,
          }}
        />
      </div>
    </main>
  )
}
