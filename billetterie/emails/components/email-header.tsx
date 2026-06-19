// En-tête de marque partagé par les e-mails de billets (logo + nom de l'école).
// ⚠️ L'URL du logo doit être ABSOLUE : les clients mail ne résolvent pas les
// chemins relatifs (cf. lib/email/booking.ts qui passe `${baseUrl()}/…`).

import { Img, Section, Text } from 'react-email'

const terre = '#5c3d2e'

export default function EmailHeader({ logoUrl }: { logoUrl: string }) {
  return (
    <Section
      style={{
        textAlign: 'center',
        padding: '0 0 16px',
        margin: '0 0 24px',
        borderBottom: '1px solid #e8e0d4',
      }}
    >
      <Img
        src={logoUrl}
        alt="Logo École de danse Desha-Moulin"
        width={96}
        height={96}
        style={{ display: 'block', margin: '0 auto 6px' }}
      />
      <Text style={{ color: terre, fontSize: '15px', fontWeight: 'bold', letterSpacing: '0.4px', margin: 0 }}>
        École de danse Desha-Moulin
      </Text>
    </Section>
  )
}
