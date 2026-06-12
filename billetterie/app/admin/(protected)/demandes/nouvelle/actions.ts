'use server'

// Création d'une demande depuis le back-office (familles qui passent au studio
// ou appellent). Mêmes effets que le formulaire public — jauge, email de
// confirmation — mais SANS rate-limit ni honeypot (l'accès est déjà protégé
// par requireAdmin + proxy.ts).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { creerBookingEnAttente } from '@/lib/booking/creer'
import { bookingSchema, type BookingInput } from '@/lib/public/booking-schema'

export type NouvelleDemandeState = {
  ok: boolean
  error?: string
  fieldErrors?: { [K in keyof BookingInput]?: string[] }
}

export async function creerDemandeAdmin(
  _prevState: NouvelleDemandeState,
  formData: FormData,
): Promise<NouvelleDemandeState> {
  await requireAdmin()

  const parsed = bookingSchema.safeParse({
    representationId: formData.get('representationId'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    partySize: formData.get('partySize'),
    notes: formData.get('notes') ?? undefined,
    pmr: formData.get('pmr') ?? undefined,
    pmrCompanions: formData.get('pmrCompanions') ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Veuillez corriger les champs signalés.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    }
  }
  const demande = parsed.data

  const result = await creerBookingEnAttente({
    representationId: demande.representationId,
    name: `${demande.firstName} ${demande.lastName}`,
    email: demande.email,
    phone: demande.phone,
    partySize: demande.partySize,
    notes: demande.notes,
    pmr: demande.pmr,
    pmrCompanions: demande.pmrCompanions,
  })
  if ('error' in result) {
    return { ok: false, error: result.error }
  }

  revalidatePath('/admin/demandes')
  revalidatePath('/admin')
  // Pas de donnée perso dans l'URL (access logs amont).
  redirect('/admin/demandes?ok=' + encodeURIComponent('Demande créée.'))
}
