// Carte « place » en LECTURE SEULE : siège (section / rang / place) + QR +
// récap « groupe de … ». Partagée par le formulaire /place (résultat inline,
// contexte client) ET le lien direct /place/[qrToken] (contexte serveur).
// Aucune directive → composant « partagé » ; props 100 % sérialisables.

import QrFullscreen from '@/app/billets/[publicToken]/qr-fullscreen'

import styles from './place.module.css'

export type PlaceCardData = {
  titre: string
  dateLabel: string
  section: string
  rang: string
  place: number
  qrToken: string
  proprioPrenom: string
}

export default function PlaceCard({ data }: { data: PlaceCardData }) {
  return (
    <article className={styles.placeCard} aria-live="polite">
      <p className={styles.placeKicker}>Lecture seule · place partagée</p>
      <h2 className={styles.placeTitle}>{data.titre}</h2>
      <p className={styles.placeDate}>{data.dateLabel}</p>
      <dl className={styles.placeSeat}>
        <div>
          <dt>Section</dt>
          <dd>{data.section}</dd>
        </div>
        <div>
          <dt>Rang</dt>
          <dd>{data.rang}</dd>
        </div>
        <div>
          <dt>Place</dt>
          <dd>{data.place}</dd>
        </div>
      </dl>

      <QrFullscreen
        src={`/api/qr/${data.qrToken}.png`}
        rang={data.rang}
        place={data.place}
        titre={data.titre}
      />

      <p className={styles.placeRecap}>
        Place de la réservation au nom du groupe de <strong>{data.proprioPrenom}</strong>.
      </p>
    </article>
  )
}
