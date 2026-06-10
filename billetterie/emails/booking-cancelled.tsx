// E-mail « Votre demande a été annulée » — envoyé quand une demande est
// annulée (expiration du délai de règlement ou annulation par l'équipe).
// Ton sobre, sans culpabiliser : on laisse une porte ouverte.

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

export interface BookingCancelledProps {
  name: string
  partySize: number
  representationTitle: string
  representationDateText: string
  formulaireUrl: string
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

export default function BookingCancelledEmail({
  name,
  partySize,
  representationTitle,
  representationDateText,
  formulaireUrl,
}: BookingCancelledProps) {
  const places = partySize > 1 ? `${partySize} places` : '1 place'
  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre demande de {places} pour {representationTitle} a été annulée.</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={h1}>Votre demande a été annulée</Heading>
          <Text style={paragraphe}>Bonjour {name},</Text>
          <Text style={paragraphe}>
            Votre demande de <strong>{places}</strong> pour la représentation{' '}
            <strong>{representationTitle}</strong> le <strong>{representationDateText}</strong> a
            été annulée. Les places concernées sont remises en vente.
          </Text>
          <Text style={paragraphe}>
            S&rsquo;il s&rsquo;agit d&rsquo;une erreur, n&rsquo;hésitez pas à contacter
            l&rsquo;école aux permanences. Et si vous souhaitez toujours assister à la
            représentation, vous pouvez tout simplement refaire une demande :
          </Text>
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button href={formulaireUrl} style={bouton}>
              Refaire une demande
            </Button>
          </Section>
          <Text style={{ ...paragraphe, fontSize: '13px', color: '#6b6258' }}>
            Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur : {formulaireUrl}
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
BookingCancelledEmail.PreviewProps = {
  name: 'Camille Dupont',
  partySize: 3,
  representationTitle: 'Samedi 20h30',
  representationDateText: 'samedi 27 juin 2026 à 20h30',
  formulaireUrl: 'http://localhost:3000',
} satisfies BookingCancelledProps
