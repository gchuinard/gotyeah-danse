// Bloc billet partagé entre « Vos billets » et « Vos places ont été modifiées ».
// Le QR est servi par l'endpoint /api/qr/<token>.png (les data-URLs inline
// sont mal supportées par les clients mail).

import { Img, Section, Text } from 'react-email'

export interface TicketBlockData {
  sectionName: string
  rowLabel: string
  seatNumber: number
  qrUrl: string
}

// Palette de l'école : sable / encre / terre.
const sable = '#faf7f2'
const encre = '#1e1a16'
const terre = '#5c3d2e'

const bloc: React.CSSProperties = {
  backgroundColor: sable,
  border: '1px solid #e8e0d4',
  borderRadius: '6px',
  margin: '0 0 16px',
  padding: '16px 20px',
  textAlign: 'center',
}

const titreBillet: React.CSSProperties = {
  color: terre,
  fontSize: '14px',
  fontWeight: 'bold',
  letterSpacing: '0.5px',
  margin: '0 0 8px',
  textTransform: 'uppercase',
}

const placement: React.CSSProperties = {
  color: encre,
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 12px',
}

export default function TicketBlock({
  index,
  ticket,
}: {
  index: number
  ticket: TicketBlockData
}) {
  return (
    <Section style={bloc}>
      <Text style={titreBillet}>Billet {index + 1}</Text>
      <Text style={placement}>
        Section <strong>{ticket.sectionName}</strong> · Rang <strong>{ticket.rowLabel}</strong> ·
        Place <strong>{ticket.seatNumber}</strong>
      </Text>
      <Img
        src={ticket.qrUrl}
        alt={`QR code du billet ${index + 1}`}
        width={160}
        height={160}
        style={{ display: 'block', margin: '0 auto', borderRadius: '4px' }}
      />
    </Section>
  )
}
