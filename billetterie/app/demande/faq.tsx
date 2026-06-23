// FAQ publique — colonne de droite de la page d'accueil.
//
// Server component : accordéon en HTML natif (<details>/<summary>), aucune
// hydratation côté client. L'attribut `name` regroupe les items en accordéon
// exclusif (un seul ouvert à la fois) sur les navigateurs récents ; ailleurs,
// la dégradation est gracieuse (plusieurs peuvent s'ouvrir).
//
// Les réponses suivent les règles métier verrouillées : pas de paiement en
// ligne, sièges attribués à la main, billets par email + QR. À garder à jour
// si ces règles changent.
//
// ⚠️ Piège SWC/Turbopack : un nœud de texte JSX qui contient une entité HTML
// (&nbsp;, &apos;…) voit son espace de TÊTE rogné. Un espace juste après une
// balise inline (« </strong> texte… &nbsp;: ») serait donc perdu → on écrit le
// séparateur en {' '} pour le garantir. Même précaution dans page.tsx
// (« Comment ça marche ») et demande-form.tsx (message de regroupement).

import type { ReactNode } from 'react'

import { MAX_PARTY_SIZE } from '@/lib/public/limits'

import styles from './faq.module.css'

type Question = { q: string; a: ReactNode; open?: boolean }

const QUESTIONS: Question[] = [
  {
    q: 'Comment et quand régler mes places ?',
    open: true,
    a: (
      <>
        Il n’y a <strong>pas de paiement en ligne</strong>. Vous réglez directement à l’école, en
        espèces ou par chèque, lors des permanences — <strong>sous 14 jours</strong>{' '}après votre
        demande. Le règlement en plusieurs fois (chèques échelonnés) est possible&nbsp;: parlez-en à
        l’équipe.
      </>
    ),
  },
  {
    q: 'Puis-je choisir mon siège ?',
    a: (
      <>
        Non. Vous indiquez seulement le <strong>nombre de places</strong>&nbsp;; c’est l’équipe qui
        attribue les sièges à la main, en plaçant votre groupe au mieux dans la salle.
      </>
    ),
  },
  {
    q: 'Serons-nous assis ensemble ?',
    a: (
      <>
        On regroupe au maximum les personnes d’une même demande. S’il existe un{' '}
        <strong>risque de séparation</strong>, le placement se fait <strong>avec vous</strong> —
        jamais sans vous prévenir.
      </>
    ),
  },
  {
    q: 'Comment vais-je recevoir mes billets ?',
    a: (
      <>
        Une fois votre demande réglée et les sièges attribués, vos billets arrivent{' '}
        <strong>par email</strong>, avec un QR code. Le soir du spectacle, présentez le QR depuis
        votre téléphone (un appui l’affiche en plein écran)&nbsp;: il est scanné à l’entrée. Des
        billets papier sont possibles — demandez à l’équipe.
      </>
    ),
  },
  {
    q: 'Combien de places puis-je demander ?',
    a: (
      <>
        Jusqu’à <strong>{MAX_PARTY_SIZE} places</strong> par demande dans le formulaire. Pour un
        groupe plus grand, contactez l’équipe aux permanences de l’école.
      </>
    ),
  },
  {
    q: 'Une personne à mobilité réduite vient avec nous ?',
    a: (
      <>
        Activez l’option <strong>« personne à mobilité réduite (PMR / fauteuil) »</strong>{' '}dans le
        formulaire&nbsp;: un emplacement adapté est réservé pour chaque personne concernée, et les
        accompagnants sont installés juste à côté.
      </>
    ),
  },
  {
    q: 'Faut-il une place pour mon enfant qui danse ?',
    a: (
      <>
        Selon l’organisation, certains tout-petits qui dansent restent en salle. Des{' '}
        <strong>places peuvent alors être offertes</strong>&nbsp;: signalez votre situation dans le
        commentaire ou auprès de l’équipe — le montant est ajusté au moment du règlement.
      </>
    ),
  },
  {
    q: 'Comment modifier ou annuler ma demande ?',
    a: (
      <>
        Tant qu’elle n’est pas réglée, utilisez l’onglet <strong>« J’ai déjà une demande »</strong>{' '}
        (email + identifiant reçu à la création) pour changer le nombre de places ou annuler. Après
        règlement, voyez avec l’équipe.
      </>
    ),
  },
  {
    q: 'Je n’ai pas reçu l’email, ou j’ai perdu mon identifiant.',
    a: (
      <>
        Vérifiez vos spams. Vous pouvez retrouver votre demande via l’onglet{' '}
        <strong>« J’ai déjà une demande »</strong>. Identifiant perdu&nbsp;? Cliquez sur{' '}
        <strong>« Identifiant oublié ou perdu ? »</strong> pour le recevoir à nouveau par email.
      </>
    ),
  },
  {
    q: 'Où et quand a lieu le spectacle ?',
    a: (
      <>
        Au <strong>Centre Culturel de Bergerac</strong>. La date et l’heure exactes figurent dans
        votre email de confirmation et sur vos billets.
      </>
    ),
  },
]

export default function Faq() {
  return (
    <section className={styles.faq} aria-label="Questions fréquentes">
      <h2 className={styles.title}>Questions fréquentes</h2>
      <div className={styles.list}>
        {QUESTIONS.map(({ q, a, open }) => (
          <details key={q} name="faq" open={open} className={styles.item}>
            <summary className={styles.summary}>{q}</summary>
            <div className={styles.answer}>{a}</div>
          </details>
        ))}
      </div>
    </section>
  )
}
