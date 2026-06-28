// Calculs d'argent (lib/admin/money) — purs, sans DB.

import { describe, expect, it } from 'vitest'

import {
  etatPaiement,
  montantDuCents,
  placesPayantes,
  resumePaiement,
  totalRemisCents,
} from '@/lib/admin/money'

const prix = { adultPriceCents: 1200, childPriceCents: 600 }

describe('placesPayantes', () => {
  it('sépare adultes / enfants et déduit les offertes des enfants d’abord', () => {
    expect(placesPayantes(5, 2, 0)).toEqual({ adultes: 3, enfants: 2 })
    expect(placesPayantes(5, 2, 1)).toEqual({ adultes: 3, enfants: 1 }) // 1 offerte → enfant
    expect(placesPayantes(5, 2, 3)).toEqual({ adultes: 2, enfants: 0 }) // 2 enfants + 1 adulte offerts
  })

  it('borne childCount et freeSeats à [0, partySize]', () => {
    expect(placesPayantes(4, 9, 0)).toEqual({ adultes: 0, enfants: 4 }) // que des enfants
    expect(placesPayantes(4, -2, 0)).toEqual({ adultes: 4, enfants: 0 }) // childCount négatif → 0
    expect(placesPayantes(3, 0, 5)).toEqual({ adultes: 0, enfants: 0 }) // tout offert
  })
})

describe('montantDuCents', () => {
  it('= adultes×prixA + enfants×prixE', () => {
    expect(montantDuCents({ partySize: 4, childCount: 0, freeSeats: 0, ...prix })).toBe(4800)
    expect(montantDuCents({ partySize: 5, childCount: 2, freeSeats: 0, ...prix })).toBe(3 * 1200 + 2 * 600)
  })

  it('déduit les places offertes (enfants d’abord)', () => {
    expect(montantDuCents({ partySize: 5, childCount: 2, freeSeats: 1, ...prix })).toBe(3 * 1200 + 1 * 600)
    expect(montantDuCents({ partySize: 3, childCount: 0, freeSeats: 5, ...prix })).toBe(0) // tout offert
  })

  it('null si un tarif NÉCESSAIRE manque, mais 0 place de cette catégorie → OK', () => {
    // Que des adultes, tarif enfant absent → dû connu.
    expect(montantDuCents({ partySize: 4, childCount: 0, freeSeats: 0, adultPriceCents: 1200, childPriceCents: null })).toBe(4800)
    // Des enfants mais tarif enfant absent → inconnu.
    expect(montantDuCents({ partySize: 4, childCount: 1, freeSeats: 0, adultPriceCents: 1200, childPriceCents: null })).toBeNull()
    // Tarif adulte absent avec des adultes → inconnu.
    expect(montantDuCents({ partySize: 4, childCount: 0, freeSeats: 0, adultPriceCents: null, childPriceCents: 600 })).toBeNull()
  })
})

describe('totalRemisCents', () => {
  it('somme les versements', () => {
    expect(
      totalRemisCents([
        { method: 'cheque', amountCents: 2000 },
        { method: 'especes', amountCents: 1000 },
      ]),
    ).toBe(3000)
  })
})

describe('resumePaiement', () => {
  const base = { partySize: 4, childCount: 0, freeSeats: 0, ...prix } // dû 4800

  it('acompte : net < dû → reste, pas soldée', () => {
    const r = resumePaiement({ ...base, payments: [{ method: 'cheque', amountCents: 2000 }], refundCents: null })
    expect(r.duCents).toBe(4800)
    expect(r.remisCents).toBe(2000)
    expect(r.netCents).toBe(2000)
    expect(r.resteCents).toBe(2800)
    expect(r.soldee).toBe(false)
    expect(r.tropPercuCents).toBe(0)
  })

  it('soldée : net = dû (mix adulte/enfant)', () => {
    // 2 adultes + 2 enfants = 2400 + 1200 = 3600.
    const r = resumePaiement({
      partySize: 4,
      childCount: 2,
      freeSeats: 0,
      ...prix,
      payments: [{ method: 'especes', amountCents: 3600 }],
      refundCents: null,
    })
    expect(r.duCents).toBe(3600)
    expect(r.soldee).toBe(true)
    expect(r.resteCents).toBe(0)
  })

  it('remboursement : net = reçu − remboursé', () => {
    const r = resumePaiement({ ...base, payments: [{ method: 'cheque', amountCents: 4800 }], refundCents: 1200 })
    expect(r.netCents).toBe(3600)
    expect(r.resteCents).toBe(1200)
    expect(r.soldee).toBe(false)
  })

  it('trop-perçu : net > dû', () => {
    const r = resumePaiement({ ...base, payments: [{ method: 'especes', amountCents: 5000 }], refundCents: null })
    expect(r.tropPercuCents).toBe(200)
    expect(r.soldee).toBe(true)
  })

  it('tarif non défini : dû/reste/soldée inconnus', () => {
    const r = resumePaiement({
      partySize: 4,
      childCount: 0,
      freeSeats: 0,
      adultPriceCents: null,
      childPriceCents: null,
      payments: [{ method: 'especes', amountCents: 1000 }],
      refundCents: null,
    })
    expect(r.duCents).toBeNull()
    expect(r.resteCents).toBeNull()
    expect(r.soldee).toBeNull()
    expect(r.netCents).toBe(1000)
  })
})

describe('etatPaiement', () => {
  const resume = (
    payments: { method: string; amountCents: number }[],
    adultPriceCents: number | null,
    refundCents: number | null = null,
  ) =>
    resumePaiement({ partySize: 4, childCount: 0, freeSeats: 0, adultPriceCents, childPriceCents: 600, payments, refundCents })

  it('non payé / sans montant selon paidAt', () => {
    expect(etatPaiement(resume([], 1200), false)).toBe('non_paye')
    expect(etatPaiement(resume([], 1200), true)).toBe('sans_montant')
  })

  it('acompte / soldée / trop-perçu', () => {
    expect(etatPaiement(resume([{ method: 'c', amountCents: 2000 }], 1200), true)).toBe('acompte')
    expect(etatPaiement(resume([{ method: 'c', amountCents: 4800 }], 1200), true)).toBe('solde')
    expect(etatPaiement(resume([{ method: 'c', amountCents: 5000 }], 1200), true)).toBe('trop_percu')
  })

  it('payé sans tarif défini', () => {
    expect(etatPaiement(resume([{ method: 'c', amountCents: 1000 }], null), true)).toBe('paye')
  })
})
