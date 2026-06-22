// Calculs d'argent (lib/admin/money) — purs, sans DB.

import { describe, expect, it } from 'vitest'

import { etatPaiement, montantDuCents, resumePaiement, totalRemisCents } from '@/lib/admin/money'

describe('montantDuCents', () => {
  it('= (places − offertes) × prix', () => {
    expect(montantDuCents(4, 0, 1200)).toBe(4800)
    expect(montantDuCents(4, 1, 1200)).toBe(3600)
  })

  it('borne les places offertes à [0, partySize]', () => {
    expect(montantDuCents(3, 5, 1000)).toBe(0) // offertes > places → tout offert
    expect(montantDuCents(3, -2, 1000)).toBe(3000) // négatif → 0 offerte
  })

  it('null si le prix n’est pas défini', () => {
    expect(montantDuCents(4, 0, null)).toBeNull()
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
  const base = { partySize: 4, freeSeats: 0, unitPriceCents: 1200 } // dû 4800

  it('acompte : net < dû → reste, pas soldée', () => {
    const r = resumePaiement({ ...base, payments: [{ method: 'cheque', amountCents: 2000 }], refundCents: null })
    expect(r.duCents).toBe(4800)
    expect(r.remisCents).toBe(2000)
    expect(r.netCents).toBe(2000)
    expect(r.resteCents).toBe(2800)
    expect(r.soldee).toBe(false)
    expect(r.tropPercuCents).toBe(0)
  })

  it('soldée : net = dû', () => {
    const r = resumePaiement({ ...base, payments: [{ method: 'especes', amountCents: 4800 }], refundCents: null })
    expect(r.soldee).toBe(true)
    expect(r.resteCents).toBe(0)
  })

  it('remboursement : net = reçu − remboursé', () => {
    const r = resumePaiement({ ...base, payments: [{ method: 'cheque', amountCents: 4800 }], refundCents: 1200 })
    expect(r.remisCents).toBe(4800)
    expect(r.rembourseCents).toBe(1200)
    expect(r.netCents).toBe(3600)
    expect(r.resteCents).toBe(1200)
    expect(r.soldee).toBe(false)
  })

  it('trop-perçu : net > dû', () => {
    const r = resumePaiement({ ...base, payments: [{ method: 'especes', amountCents: 5000 }], refundCents: null })
    expect(r.tropPercuCents).toBe(200)
    expect(r.resteCents).toBe(0)
    expect(r.soldee).toBe(true)
  })

  it('prix non défini : dû/reste/soldée inconnus', () => {
    const r = resumePaiement({
      partySize: 4,
      freeSeats: 0,
      unitPriceCents: null,
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
  const resume = (payments: { method: string; amountCents: number }[], unitPriceCents: number | null, refundCents: number | null = null) =>
    resumePaiement({ partySize: 4, freeSeats: 0, unitPriceCents, payments, refundCents })

  it('non payé / sans montant selon paidAt', () => {
    expect(etatPaiement(resume([], 1200), false)).toBe('non_paye')
    expect(etatPaiement(resume([], 1200), true)).toBe('sans_montant')
  })

  it('acompte / soldée / trop-perçu', () => {
    expect(etatPaiement(resume([{ method: 'c', amountCents: 2000 }], 1200), true)).toBe('acompte')
    expect(etatPaiement(resume([{ method: 'c', amountCents: 4800 }], 1200), true)).toBe('solde')
    expect(etatPaiement(resume([{ method: 'c', amountCents: 5000 }], 1200), true)).toBe('trop_percu')
  })

  it('payé sans prix défini', () => {
    expect(etatPaiement(resume([{ method: 'c', amountCents: 1000 }], null), true)).toBe('paye')
  })
})
