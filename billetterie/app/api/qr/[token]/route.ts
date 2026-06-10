// GET /api/qr/[token] (suffixe « .png » accepté — les emails l'utilisent).
//
// PNG du QR code d'un billet EXISTANT : le QR encode uniquement le qrToken,
// aucune donnée personnelle. Token mal formé ou inconnu → 404, pour ne pas
// servir de générateur de QR ouvert. Le token n'est jamais loggé.

import QRCode from 'qrcode'

import { prisma } from '@/lib/db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const raw = (await params).token
  const token = raw.endsWith('.png') ? raw.slice(0, -'.png'.length) : raw

  if (!UUID_RE.test(token)) {
    return new Response('Introuvable', { status: 404 })
  }

  const ticket = await prisma.ticket.findUnique({
    where: { qrToken: token },
    select: { qrToken: true },
  })
  if (!ticket) {
    return new Response('Introuvable', { status: 404 })
  }

  const png = await QRCode.toBuffer(ticket.qrToken, { width: 360, margin: 2 })

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
