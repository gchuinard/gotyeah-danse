// Tests du rate-limit en mémoire (fenêtre glissante).
//
// Les timers factices contrôlent Date.now() : on peut vérifier précisément
// l'expiration des jetons en fin de fenêtre.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rateLimit, resetRateLimit } from '@/lib/rate-limit'

const OPTIONS = { limit: 3, windowMs: 10_000 }

beforeEach(() => {
  vi.useFakeTimers()
  resetRateLimit()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rateLimit', () => {
  it("autorise jusqu'à `limit` appels dans la fenêtre", () => {
    expect(rateLimit('ip-1', OPTIONS)).toBe(true)
    expect(rateLimit('ip-1', OPTIONS)).toBe(true)
    expect(rateLimit('ip-1', OPTIONS)).toBe(true)
  })

  it('bloque le (limit+1)-ième appel dans la même fenêtre', () => {
    for (let i = 0; i < OPTIONS.limit; i++) {
      expect(rateLimit('ip-1', OPTIONS)).toBe(true)
    }
    expect(rateLimit('ip-1', OPTIONS)).toBe(false)
    // Et reste bloqué tant que la fenêtre n'a pas glissé.
    expect(rateLimit('ip-1', OPTIONS)).toBe(false)
  })

  it('les clés sont indépendantes', () => {
    for (let i = 0; i < OPTIONS.limit; i++) rateLimit('ip-1', OPTIONS)
    expect(rateLimit('ip-1', OPTIONS)).toBe(false)
    expect(rateLimit('ip-2', OPTIONS)).toBe(true)
  })

  it('fenêtre glissante : les jetons expirent individuellement', () => {
    // t=0 : deux appels. t=5s : un troisième → limite atteinte.
    rateLimit('ip-1', OPTIONS)
    rateLimit('ip-1', OPTIONS)
    vi.advanceTimersByTime(5_000)
    rateLimit('ip-1', OPTIONS)
    expect(rateLimit('ip-1', OPTIONS)).toBe(false)

    // t=10s : les deux jetons de t=0 sont sortis de la fenêtre,
    // il ne reste que celui de t=5s → deux appels passent à nouveau…
    vi.advanceTimersByTime(5_000)
    expect(rateLimit('ip-1', OPTIONS)).toBe(true)
    expect(rateLimit('ip-1', OPTIONS)).toBe(true)

    // …mais le jeton de t=5s compte toujours : 1 + 2 = limite → bloqué.
    expect(rateLimit('ip-1', OPTIONS)).toBe(false)
  })

  it('après une fenêtre complète sans appel, tout est de nouveau autorisé', () => {
    for (let i = 0; i < OPTIONS.limit; i++) rateLimit('ip-1', OPTIONS)
    expect(rateLimit('ip-1', OPTIONS)).toBe(false)

    vi.advanceTimersByTime(OPTIONS.windowMs + 1)
    expect(rateLimit('ip-1', OPTIONS)).toBe(true)
  })

  it('resetRateLimit vide tous les compteurs', () => {
    for (let i = 0; i < OPTIONS.limit; i++) rateLimit('ip-1', OPTIONS)
    expect(rateLimit('ip-1', OPTIONS)).toBe(false)
    resetRateLimit()
    expect(rateLimit('ip-1', OPTIONS)).toBe(true)
  })
})
