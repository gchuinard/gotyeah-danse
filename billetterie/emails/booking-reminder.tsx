// E-mail « petit rappel » — relance J+7 envoyée par le cron quand une demande
// en attente n'a toujours pas été réglée. Les dates arrivent déjà formatées
// en texte (mise en forme dans lib/email/booking.ts, fuseau Europe/Paris).

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

export interface BookingReminderProps {
  name: string
  partySize: number
  representationTitle: string
  representationDateText: string
  dateLimiteText: string
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

const encadre: React.CSSProperties = {
  backgroundColor: sable,
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

export default function BookingReminderEmail({
  name,
  partySize,
  representationTitle,
  representationDateText,
  dateLimiteText,
  billetsUrl,
  logoUrl,
}: BookingReminderProps) {
  const places = partySize > 1 ? `${partySize} places` : '1 place'
  return (
    <Html lang="fr">
      <Head />
      <Preview>Petit rappel : votre demande de {places} attend toujours son règlement.</Preview>
      <Body style={body}>
        <Container style={container}>
          <EmailHeader logoUrl={logoUrl} />
          <Heading style={h1}>Petit rappel pour vos places</Heading>
          <Text style={paragraphe}>Bonjour {name},</Text>
          <Text style={paragraphe}>
            Votre demande de <strong>{places}</strong> pour la représentation{' '}
            <strong>{representationTitle}</strong> le <strong>{representationDateText}</strong>{' '}
            attend toujours son règlement.
          </Text>
          <Section style={encadre}>
            <Text style={{ ...paragraphe, margin: 0 }}>
              Pour la confirmer, il suffit de régler par <strong>chèque ou espèces</strong> aux
              permanences de l&rsquo;école avant le <strong>{dateLimiteText}</strong>. Passé cette
              date, la demande expirera et les places seront remises en vente.
            </Text>
          </Section>
          <Text style={paragraphe}>
            Si vous avez déjà réglé, vous n&rsquo;avez rien à faire : vos places seront attribuées
            très bientôt et vos billets apparaîtront sur votre page de suivi.
          </Text>
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button href={billetsUrl} style={bouton}>
              Suivre ma demande
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
BookingReminderEmail.PreviewProps = {
  name: 'Camille Dupont',
  partySize: 3,
  representationTitle: 'Samedi 20h30',
  representationDateText: 'samedi 27 juin 2026 à 20h30',
  dateLimiteText: 'jeudi 25 juin 2026',
  billetsUrl: 'http://localhost:3000/billets/exemple-token',
  logoUrl: 'http://localhost:3000/logo-desha-moulin.png',
} satisfies BookingReminderProps
