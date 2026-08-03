// Archivage (« clôture ») d'une représentation — SOURCE UNIQUE de la règle.
//
// Une représentation archivée (`archivedAt` non null) :
//  - sort des écrans du quotidien : liste des demandes, tableau de bord,
//    sélecteurs de /admin/plan et /admin/scan, formulaire public ;
//  - voit ses demandes GELÉES : plus aucune action (versement, remboursement,
//    placement, annulation, envoi de billets, scan, modification par la
//    famille) tant qu'elle n'est pas désarchivée ;
//  - garde TOUT en base : /admin/stats, l'historique et l'export CSV
//    continuent de la lire — c'est toute la différence avec une suppression.
//
// Rien n'est muté à l'archivage (les demandes en attente restent « en
// attente ») : désarchiver restitue exactement l'état d'avant.
//
// Seul un super-admin archive/désarchive (zone `representations`, cf.
// lib/auth/roles.ts) ; l'exclusion et le gel, eux, s'appliquent à tout le monde.

import type { Prisma, PrismaClient } from '@prisma/client'

// Accepte le client global OU un client transactionnel (mêmes contraintes que
// lib/jauge : une garde doit pouvoir vivre dans la transaction appelante).
export type Db = PrismaClient | Prisma.TransactionClient

// Statuts d'une demande « vivante » — celles qu'un archivage fige réellement.
const STATUTS_VIVANTS = ['pending', 'paid', 'placed'] as const

// Filtre « représentation active » — à composer dans les `where` Prisma.
export const REP_ACTIVE = { archivedAt: null } satisfies Prisma.RepresentationWhereInput

// Filtre « représentation archivée » (la vue lecture seule des demandes).
export const REP_ARCHIVEE = { archivedAt: { not: null } } satisfies Prisma.RepresentationWhereInput

// Filtres côté Booking : demandes d'une rep active / archivée.
export const DEMANDES_ACTIVES = {
  representation: { is: REP_ACTIVE },
} satisfies Prisma.BookingWhereInput

export const DEMANDES_ARCHIVEES = {
  representation: { is: REP_ARCHIVEE },
} satisfies Prisma.BookingWhereInput

// Message unique du gel : toutes les actions le renvoient tel quel.
export const MESSAGE_GELEE =
  'Représentation archivée : cette demande est gelée. Désarchive-la dans « Représentations » pour la modifier.'

// Version « famille » du même refus (page /billets/<token>) — sans jargon admin.
export const MESSAGE_GELEE_PUBLIC =
  'Ce spectacle est clôturé : la demande n’est plus modifiable. Contactez les permanences de l’école.'

// Vrai si la représentation de cette demande est archivée. Une demande
// introuvable renvoie `false` : ce n'est pas le rôle de cette fonction de le
// dire — l'appelant lèvera son propre message, plus précis.
export async function demandeGelee(db: Db, bookingId: string): Promise<boolean> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { representation: { select: { archivedAt: true } } },
  })
  return booking?.representation.archivedAt != null
}

// Garde des actions mutantes : lève MESSAGE_GELEE si la demande est gelée.
export async function assertDemandeModifiable(db: Db, bookingId: string): Promise<void> {
  if (await demandeGelee(db, bookingId)) throw new Error(MESSAGE_GELEE)
}

// Même garde, à partir du token public (actions côté famille).
export async function assertDemandeModifiableParToken(db: Db, publicToken: string): Promise<void> {
  const booking = await db.booking.findUnique({
    where: { publicToken },
    select: { representation: { select: { archivedAt: true } } },
  })
  if (booking?.representation.archivedAt != null) throw new Error(MESSAGE_GELEE_PUBLIC)
}

// Nombre de demandes VIVANTES par représentation — sert à chiffrer l'impact
// AVANT d'archiver (« 3 demandes seront gelées »). Une seule requête pour tout
// le tableau, les annulées / expirées ne comptent pas (elles ne gèlent rien).
export async function demandesVivantesParRepresentation(db: Db): Promise<Map<string, number>> {
  const lignes = await db.booking.groupBy({
    by: ['representationId'],
    where: { status: { in: [...STATUTS_VIVANTS] } },
    _count: { _all: true },
  })
  return new Map(lignes.map((l) => [l.representationId, l._count._all]))
}
