// Modification d'une représentation (titre + date/heure de Paris).

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { toParisInputValue } from '@/lib/paris-time'
import { modifierRepresentation } from '../actions'
import styles from '../representations.module.css'

export const metadata: Metadata = { title: 'Modifier une représentation — Admin' }
export const dynamic = 'force-dynamic'

export default async function ModifierRepresentationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const rep = await prisma.representation.findUnique({
    where: { id },
    include: { _count: { select: { bookings: true, tickets: true } } },
  })
  if (!rep) notFound()

  return (
    <main>
      <h1 className={styles.title}>Modifier « {rep.title} »</h1>

      {rep._count.bookings > 0 && (
        <p className={styles.bannerWarn}>
          {rep._count.bookings} demande(s) et {rep._count.tickets} billet(s) sont liés à cette
          représentation. En cas de changement de date, pense à prévenir les familles (l&rsquo;appli
          n&rsquo;envoie pas d&rsquo;email automatique pour ça).
        </p>
      )}

      <section className={styles.createCard}>
        <form action={modifierRepresentation} className={styles.createForm}>
          <input type="hidden" name="id" value={rep.id} />
          <label className={styles.field}>
            Titre
            <input
              className={styles.input}
              type="text"
              name="title"
              defaultValue={rep.title}
              minLength={2}
              maxLength={100}
              required
            />
          </label>
          <label className={styles.field}>
            Date et heure (heure de Paris)
            <input
              className={styles.input}
              type="datetime-local"
              name="startsAt"
              defaultValue={toParisInputValue(rep.startsAt)}
              required
            />
          </label>
          <button type="submit" className={styles.btnPrimary}>
            Enregistrer
          </button>
        </form>
      </section>

      <p>
        <Link className={styles.btn} href="/admin/representations">
          ← Retour aux représentations
        </Link>
      </p>
    </main>
  )
}
