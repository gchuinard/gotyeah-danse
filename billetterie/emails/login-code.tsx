// E-mail « code de connexion » — login admin sans mot de passe.
// Le code n'est valable que 10 minutes et à usage unique.

import { Body, Container, Head, Heading, Html, Preview, Section, Text } from 'react-email'

export interface LoginCodeProps {
  code: string
}

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
  border: '1px solid #e8e0d4',
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

const codeStyle: React.CSSProperties = {
  backgroundColor: sable,
  borderRadius: '6px',
  color: terre,
  fontFamily: 'monospace',
  fontSize: '32px',
  fontWeight: 'bold',
  letterSpacing: '8px',
  margin: 0,
  padding: '16px 24px',
  textAlign: 'center',
}

export default function LoginCodeEmail({ code }: LoginCodeProps) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>Votre code de connexion : {code}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={h1}>Connexion à la billetterie</Heading>
          <Text style={paragraphe}>Voici votre code de connexion :</Text>
          <Section style={{ margin: '0 0 16px' }}>
            <Text style={codeStyle}>{code}</Text>
          </Section>
          <Text style={paragraphe}>
            Il est valable <strong>10 minutes</strong> et ne peut servir qu&rsquo;une fois.
          </Text>
          <Text style={{ ...paragraphe, fontSize: '13px', color: '#6b6258', margin: 0 }}>
            Si vous n&rsquo;êtes pas à l&rsquo;origine de cette demande, ignorez simplement cet
            e-mail : sans ce code, personne ne peut se connecter.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

// Données factices pour l'aperçu (`npx react-email dev`).
LoginCodeEmail.PreviewProps = { code: '042713' } satisfies LoginCodeProps
