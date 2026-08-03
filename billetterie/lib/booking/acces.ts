// Accès « j'ai déjà une demande » SANS email à chaque connexion : email +
// IDENTIFIANT de demande (codeDemande, dérivé du token, envoyé à la création).
// Suffisant pour ce contexte (école), couplé au rate-limit côté action.

import { prisma } from '@/lib/db'

import { codeDemande, normaliserCode } from './code'

export type AccesResultat =
  | { type: 'trouvee'; publicToken: string }
  | { type: 'introuvable' }

// Email + identifiant → la demande correspondante (quel que soit son statut :
// la page /billets/[token] affiche la modif si en attente, les billets si
// placée). On exclut seulement les demandes annulées.
export async function trouverDemandeParCode(
  emailRaw: string,
  codeRaw: string,
): Promise<AccesResultat> {
  const email = emailRaw.trim().toLowerCase()
  const code = normaliserCode(codeRaw)
  // Égalité STRICTE ensuite : un code trop court/long ne matchera pas.
  if (!email || !code) return { type: 'introuvable' }

  const bookings = await prisma.booking.findMany({
    where: { email, status: { in: ['pending', 'paid', 'placed'] } },
    select: { publicToken: true },
  })
  const match = bookings.find((b) => codeDemande(b.publicToken) === code)
  return match ? { type: 'trouvee', publicToken: match.publicToken } : { type: 'introuvable' }
}

// Demande EN ATTENTE d'un email, pour renvoyer l'identifiant par mail.
// (Une seule demande active par email — cf. détection de doublon.)
//
// Les représentations ARCHIVÉES sont exclues : renvoyer un identifiant de
// demande pour un spectacle clôturé n'aurait aucun sens (la demande est gelée).
// La CONSULTATION d'une demande archivée reste ouverte (trouverDemandeParCode) :
// la famille garde l'accès à ses billets.
export async function demandeEnAttentePourEmail(emailRaw: string, now = new Date()) {
  const email = emailRaw.trim().toLowerCase()
  if (!email) return null
  return prisma.booking.findFirst({
    where: {
      email,
      status: 'pending',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      representation: { is: { archivedAt: null } },
    },
    include: { representation: { select: { title: true, startsAt: true } } },
  })
}
