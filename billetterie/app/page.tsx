// Page d'accueil publique — formulaire de demande de places.
//
// Server component : charge les représentations ouvertes et leur jauge depuis
// la DB, ne propose que celles où il reste de la place. La lecture DB doit
// être faite à chaque requête → rendu dynamique forcé (pas de cache statique).

import { getTicketPriceCents } from '@/lib/admin/pricing'
import { prisma } from '@/lib/db'
import { representationsOuvertes } from '@/lib/jauge'
import { turnstileEnabled, turnstileSiteKey } from '@/lib/public/turnstile'

import AccesForm from './demande/acces-form'
import DemandeForm from './demande/demande-form'
import Onglets from './demande/onglets'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function Home() {
  // Une seule représentation par an : on prend la première ouverte où il
  // reste de la place — pas de choix proposé à la famille.
  const ouvertes = await representationsOuvertes(prisma)
  const representationId = ouvertes.find((rep) => rep.jauge > 0)?.id ?? null
  // Prix unitaire (global) : sert à afficher un montant indicatif sous le choix
  // du nombre de places. null = non défini → on n'affiche pas de montant.
  const unitPriceCents = await getTicketPriceCents(prisma)
  // On n'affiche le widget Turnstile QUE si la vérification est réellement
  // active côté serveur (clé secrète présente) : sinon, ni widget ni blocage
  // (cohérence client/serveur, pas de « fausse confiance »).
  const siteKey = turnstileEnabled() ? turnstileSiteKey() : undefined
  // Page dynamique (force-dynamic) : un horodatage serveur par requête est
  // exactement ce qu'on veut pour le time-trap → la règle de pureté ne
  // s'applique pas ici.
  // eslint-disable-next-line react-hooks/purity
  const formRenderedAt = Date.now()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.logo} src="/logo-desha-moulin.png" alt="École de danse Desha-Moulin" width={88} height={88} />
        <h1 className={styles.title}>Billetterie — Spectacle de fin d&apos;année</h1>
        <p className={styles.subtitle}>École de danse Desha-Moulin</p>
      </header>

      <main className={styles.main}>
        <section className={styles.steps} aria-label="Comment ça marche">
          <h2 className={styles.stepsTitle}>Comment ça marche ?</h2>
          <ol className={styles.stepsList}>
            <li>
              <strong>Vous demandez vos places</strong> : indiquez le nombre de places souhaité.
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
          <Onglets
            nouvelle={
              representationId ? (
                <DemandeForm
                  representationId={representationId}
                  turnstileSiteKey={siteKey}
                  formRenderedAt={formRenderedAt}
                  unitPriceCents={unitPriceCents}
                />
              ) : (
                <p className={styles.complet}>
                  Les demandes de places ne sont pas ouvertes pour le moment.
                </p>
              )
            }
            acces={<AccesForm />}
          />
        </section>
      </main>
    </div>
  )
}
