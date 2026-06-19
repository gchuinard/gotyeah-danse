// Journal d'audit des demandes : enregistre QUI a fait QUOI sur une demande.
// Best-effort — un échec d'écriture du log ne doit JAMAIS faire échouer l'action
// métier. Le rendu de l'historique lit `action` + `detail` + `adminEmail`.

import { prisma } from '@/lib/db'

// Auteur affiché pour une création faite depuis le formulaire public (pas de
// session admin).
export const ACTOR_PUBLIC = 'demande en ligne'

// Libellés FR des codes d'action (affichés dans l'historique).
export const ACTION_LABELS: Record<string, string> = {
  created: 'Demande créée',
  paid: 'Marquée payée',
  unpaid: 'Règlement annulé',
  placed: 'Placée',
  moved: 'Places déplacées',
  cancelled: 'Annulée',
  extended: 'Échéance prolongée (+14 j)',
  party_changed: 'Nombre de places modifié',
  ticket_mode: 'Mode de remise changé',
  note: 'Note interne modifiée',
  tickets_sent: 'Billets (r)envoyés',
}

export async function logBookingEvent(
  bookingId: string,
  action: string,
  adminEmail: string,
  detail?: string | null,
): Promise<void> {
  try {
    await prisma.bookingEvent.create({
      data: { bookingId, action, adminEmail, detail: detail ?? null },
    })
  } catch {
    // Ignoré volontairement : le log ne bloque jamais l'action.
  }
}
