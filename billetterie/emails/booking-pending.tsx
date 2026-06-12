// E-mail « demande enregistrée » — envoyé juste après le formulaire public.
// Les dates arrivent déjà formatées en texte (la mise en forme est faite
// dans lib/email/booking.ts, fuseau Europe/Paris).

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

export interface BookingPendingProps {
  name: string
  partySize: number
  representationTitle: string
  representationDateText: string
  dateLimiteText: string
  billetsUrl: string
  codeDemande: string
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

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, "Courier New", monospace',
  fontSize: '24px',
  fontWeight: 'bold',
  letterSpacing: '4px',
  color: terre,
  margin: '4px 0 0',
}

export default function BookingPendingEmail({
  name,
  partySize,
  representationTitle,
  representationDateText,
  dateLimiteText,
  billetsUrl,
  codeDemande,
}: BookingPendingProps) {
  const places = partySize > 1 ? `${partySize} places` : '1 place'
  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre demande de {places} est bien enregistrée — règlement sous 14 jours.</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={h1}>Votre demande est bien enregistrée</Heading>
          <Text style={paragraphe}>Bonjour {name},</Text>
          <Text style={paragraphe}>
            Nous avons bien reçu votre demande de <strong>{places}</strong> pour la
            représentation <strong>{representationTitle}</strong> le{' '}
            <strong>{representationDateText}</strong>.
          </Text>
          <Section style={encadre}>
            <Text style={{ ...paragraphe, margin: 0 }}>
              Pour la confirmer, merci de régler par <strong>chèque ou espèces</strong> aux
              permanences de l&rsquo;école <strong>sous 14 jours</strong>, c&rsquo;est-à-dire avant
              le <strong>{dateLimiteText}</strong>. Passé ce délai, la demande expire et les
              places sont remises en vente.
            </Text>
          </Section>
          <Text style={paragraphe}>
            Une fois le règlement reçu, vos places seront attribuées par notre équipe et vos
            billets apparaîtront sur votre page de suivi.
          </Text>
          <Section style={encadre}>
            <Text style={{ ...paragraphe, margin: 0, fontSize: '14px' }}>
              <strong>Votre identifiant de demande :</strong>
            </Text>
            <Text style={codeStyle}>{codeDemande}</Text>
            <Text style={{ ...paragraphe, margin: '8px 0 0', fontSize: '13px', color: '#6b6258' }}>
              Gardez-le : avec votre adresse e-mail, il vous permet de retrouver, modifier ou
              annuler votre demande depuis l&rsquo;onglet « J&rsquo;ai déjà une demande ».
            </Text>
          </Section>
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
BookingPendingEmail.PreviewProps = {
  name: 'Camille Dupont',
  partySize: 3,
  representationTitle: 'Samedi 20h30',
  representationDateText: 'samedi 27 juin 2026 à 20h30',
  dateLimiteText: 'jeudi 25 juin 2026',
  billetsUrl: 'http://localhost:3000/billets/exemple-token',
  codeDemande: 'AB3CDE',
} satisfies BookingPendingProps
