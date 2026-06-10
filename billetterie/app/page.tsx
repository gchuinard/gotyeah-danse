// Page d'accueil publique — formulaire de demande de places.
//
// Server component : charge les représentations ouvertes et leur jauge depuis
// la DB, ne propose que celles où il reste de la place. La lecture DB doit
// être faite à chaque requête → rendu dynamique forcé (pas de cache statique).

import { prisma } from '@/lib/db'
import { representationsOuvertes } from '@/lib/jauge'

import DemandeForm, { type RepresentationOption } from './demande/demande-form'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

// Dates affichées en heure de Paris, quel que soit le fuseau du serveur.
const formatDate = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export default async function Home() {
  const ouvertes = await representationsOuvertes(prisma)
  const disponibles: RepresentationOption[] = ouvertes
    .filter((rep) => rep.jauge > 0)
    .map((rep) => ({
      id: rep.id,
      label: `${rep.title} — ${formatDate.format(rep.startsAt)}`,
    }))

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Billetterie — Spectacle de fin d&apos;année</h1>
        <p className={styles.subtitle}>École de danse Desha-Moulin</p>
      </header>

      <main className={styles.main}>
        <section className={styles.steps} aria-label="Comment ça marche">
          <h2 className={styles.stepsTitle}>Comment ça marche ?</h2>
          <ol className={styles.stepsList}>
            <li>
              <strong>Vous demandez vos places</strong> : choisissez une représentation et le
              nombre de places souhaité.
            </li>
            <li>
              <strong>Vous réglez aux permanences</strong> de l&apos;école (chèque ou espèces)
              sous 14 jours.
            </li>
            <li>
              <strong>L&apos;équipe attribue les sièges</strong> et vous recevez vos billets par
              email.
            </li>
          </ol>
        </section>

        <section className={styles.formCard} aria-label="Demande de places">
          {disponibles.length > 0 ? (
            <DemandeForm representations={disponibles} />
          ) : (
            <p className={styles.complet}>Toutes les représentations sont complètes.</p>
          )}
        </section>
      </main>
    </div>
  )
}
