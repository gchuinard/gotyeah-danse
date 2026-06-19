// E-mail « Vos places ont été modifiées » — envoyé quand l'équipe a dû
// déplacer les places d'une réservation déjà confirmée. Les anciens QR
// sont révoqués : on insiste là-dessus avant de présenter les nouveaux billets.

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
import EmailHeader from './components/email-header'
import TicketBlock, { type TicketBlockData } from './components/ticket-block'

export interface BookingMovedProps {
  name: string
  representationTitle: string
  representationDateText: string
  tickets: TicketBlockData[]
  billetsUrl: string
  logoUrl: string
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

const avertissement: React.CSSProperties = {
  backgroundColor: '#fdf3ee',
  borderLeft: `3px solid ${terre}`,
  borderRadius: '4px',
  margin: '0 0 16px',
  padding: '12px 16px',
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

export default function BookingMovedEmail({
  name,
  representationTitle,
  representationDateText,
  tickets,
  billetsUrl,
  logoUrl,
}: BookingMovedProps) {
  const places = tickets.length > 1 ? 'vos places' : 'votre place'
  return (
    <Html lang="fr">
      <Head />
      <Preview>Vos places pour {representationTitle} ont changé — nouveaux billets ci-dessous.</Preview>
      <Body style={body}>
        <Container style={container}>
          <EmailHeader logoUrl={logoUrl} />
          <Heading style={h1}>Vos places ont été modifiées</Heading>
          <Text style={paragraphe}>Bonjour {name},</Text>
          <Text style={paragraphe}>
            Pour des raisons d&rsquo;organisation de la salle, notre équipe a dû déplacer {places}{' '}
            pour la représentation <strong>{representationTitle}</strong> le{' '}
            <strong>{representationDateText}</strong>. Nous vous prions de nous en excuser.
          </Text>
          <Section style={avertissement}>
            <Text style={{ ...paragraphe, margin: 0 }}>
              ⚠️ <strong>Les anciens billets et leurs QR codes ne sont plus valables.</strong> Merci
              d&rsquo;utiliser uniquement les nouveaux billets ci-dessous.
            </Text>
          </Section>
          <Text style={paragraphe}>Voici vos nouvelles places :</Text>
          {tickets.map((ticket, index) => (
            <TicketBlock key={index} index={index} ticket={ticket} />
          ))}
          <Text style={paragraphe}>
            Le jour de la représentation, présentez ces QR codes à l&rsquo;entrée, sur votre
            téléphone ou imprimés.
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
BookingMovedEmail.PreviewProps = {
  name: 'Camille Dupont',
  representationTitle: 'Samedi 20h30',
  representationDateText: 'samedi 27 juin 2026 à 20h30',
  tickets: [
    {
      sectionName: 'Gauche',
      rowLabel: 'F',
      seatNumber: 4,
      qrUrl: 'http://localhost:3000/api/qr/exemple-qr-3.png',
    },
    {
      sectionName: 'Gauche',
      rowLabel: 'F',
      seatNumber: 5,
      qrUrl: 'http://localhost:3000/api/qr/exemple-qr-4.png',
    },
  ],
  billetsUrl: 'http://localhost:3000/billets/exemple-token',
  logoUrl: 'http://localhost:3000/logo-desha-moulin.png',
} satisfies BookingMovedProps
