// E-mail « Vos billets » — envoyé quand les places sont attribuées après règlement.
// Les dates arrivent déjà formatées en texte (lib/email/booking.ts, Europe/Paris).

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'react-email'
import TicketBlock, { type TicketBlockData } from './components/ticket-block'

export interface BookingTicketsProps {
  name: string
  representationTitle: string
  representationDateText: string
  tickets: TicketBlockData[]
  billetsUrl: string
}

// Palette de l'école : sable / encre / terre.
const sable = '#faf7f2'
const encre = '#1e1a16'
const terre = '#5c3d2e'

const body: React.CSSProperties = {
  backgroundColor: sable,
  fontFamily: 'Georgia, "Times New Roman", serif',
  color: encre,
  margin: 0,
  padding: '24px 0',
}

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: `1px solid #e8e0d4`,
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '560px',
  padding: '32px 40px',
}

const h1: React.CSSProperties = {
  color: terre,
  fontSize: '22px',
  fontWeight: 'bold',
  margin: '0 0 16px',
}

const paragraphe: React.CSSProperties = {
  color: encre,
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 16px',
}

const bouton: React.CSSProperties = {
  backgroundColor: terre,
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '15px',
  padding: '12px 24px',
  textDecoration: 'none',
}

const signature: React.CSSProperties = {
  color: terre,
  fontSize: '14px',
  lineHeight: '22px',
  margin: '16px 0 0',
}

export default function BookingTicketsEmail({
  name,
  representationTitle,
  representationDateText,
  tickets,
  billetsUrl,
}: BookingTicketsProps) {
  const places = tickets.length > 1 ? `${tickets.length} places` : '1 place'
  return (
    <Html lang="fr">
      <Head />
      <Preview>Vos billets pour {representationTitle} sont prêts.</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={h1}>Vos billets</Heading>
          <Text style={paragraphe}>Bonjour {name},</Text>
          <Text style={paragraphe}>
            Voici vos <strong>{places}</strong> pour la représentation{' '}
            <strong>{representationTitle}</strong> le <strong>{representationDateText}</strong>.
          </Text>
          {tickets.map((ticket, index) => (
            <TicketBlock key={index} index={index} ticket={ticket} />
          ))}
          <Text style={paragraphe}>
            Le jour de la représentation, présentez simplement les QR codes à l&rsquo;entrée, sur
            votre téléphone ou imprimés. Les QR codes ne contiennent aucune donnée personnelle.
          </Text>
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button href={billetsUrl} style={bouton}>
              Voir / imprimer mes billets
            </Button>
          </Section>
          <Text style={{ ...paragraphe, fontSize: '13px', color: '#6b6258' }}>
            Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur : {billetsUrl}
          </Text>
          <Hr style={{ borderColor: '#e8e0d4', margin: '24px 0 0' }} />
          <Text style={signature}>
            À très bientôt,
            <br />
            École de danse Desha-Moulin
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

// Données factices pour l'aperçu (`npx react-email dev`).
BookingTicketsEmail.PreviewProps = {
  name: 'Camille Dupont',
  representationTitle: 'Samedi 20h30',
  representationDateText: 'samedi 27 juin 2026 à 20h30',
  tickets: [
    {
      sectionName: 'Centre',
      rowLabel: 'D',
      seatNumber: 12,
      qrUrl: 'http://localhost:3000/api/qr/exemple-qr-1.png',
    },
    {
      sectionName: 'Centre',
      rowLabel: 'D',
      seatNumber: 13,
      qrUrl: 'http://localhost:3000/api/qr/exemple-qr-2.png',
    },
  ],
  billetsUrl: 'http://localhost:3000/billets/exemple-token',
} satisfies BookingTicketsProps
