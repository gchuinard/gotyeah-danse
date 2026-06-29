// Vérification Cloudflare Turnstile côté serveur (lib/public/turnstile.ts).
//
// Deux variables d'env pilotent tout : TURNSTILE_SITE_KEY (clé publique passée
// au client) et TURNSTILE_SECRET_KEY (active la vérification serveur). SANS clé
// secrète, on ne bloque rien (bypass dev) — c'est la garantie qui compte.
// Piège Node : affecter `undefined` à process.env.X écrit la chaîne "undefined"
// → pour le cas « non défini » il faut `delete process.env.X`.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { turnstileEnabled, turnstileSiteKey, verifyTurnstile } from '@/lib/public/turnstile'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

let siteKeyBackup: string | undefined
let secretKeyBackup: string | undefined

beforeAll(() => {
  siteKeyBackup = process.env.TURNSTILE_SITE_KEY
  secretKeyBackup = process.env.TURNSTILE_SECRET_KEY
})

beforeEach(() => {
  // État neutre par défaut : aucune clé → CAPTCHA désactivé.
  delete process.env.TURNSTILE_SITE_KEY
  delete process.env.TURNSTILE_SECRET_KEY
})

afterEach(() => {
  // Restaure l'env réel et défait les espions (fetch, console.error).
  restoreEnv('TURNSTILE_SITE_KEY', siteKeyBackup)
  restoreEnv('TURNSTILE_SECRET_KEY', secretKeyBackup)
  vi.restoreAllMocks()
})

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

// Réponse fetch factice (assez proche d'un Response pour le code testé).
function fakeResponse(init: { ok: boolean; json?: () => Promise<unknown> }): Response {
  return {
    ok: init.ok,
    json: init.json ?? (async () => ({})),
  } as unknown as Response
}

describe('turnstileSiteKey', () => {
  it('non défini → undefined', () => {
    delete process.env.TURNSTILE_SITE_KEY
    expect(turnstileSiteKey()).toBeUndefined()
  })

  it('chaîne vide → undefined (jamais une clé vide)', () => {
    process.env.TURNSTILE_SITE_KEY = ''
    expect(turnstileSiteKey()).toBeUndefined()
  })

  it('défini → renvoie la valeur telle quelle', () => {
    process.env.TURNSTILE_SITE_KEY = '0xAAAA_site_key'
    expect(turnstileSiteKey()).toBe('0xAAAA_site_key')
  })
})

describe('turnstileEnabled', () => {
  it('sans TURNSTILE_SECRET_KEY → false (désactivé)', () => {
    delete process.env.TURNSTILE_SECRET_KEY
    expect(turnstileEnabled()).toBe(false)
  })

  it('chaîne vide → false (pas de clé = pas de protection)', () => {
    process.env.TURNSTILE_SECRET_KEY = ''
    expect(turnstileEnabled()).toBe(false)
  })

  it('clé secrète présente → true (activé)', () => {
    process.env.TURNSTILE_SECRET_KEY = '0xBBBB_secret'
    expect(turnstileEnabled()).toBe(true)
  })
})

describe('verifyTurnstile — CAPTCHA désactivé (pas de clé secrète)', () => {
  it('sans secret → true même sans token (bypass dev)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    await expect(verifyTurnstile(undefined, '203.0.113.7')).resolves.toBe(true)
  })

  it('sans secret → true même avec un token, et n’appelle jamais Cloudflare', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(verifyTurnstile('un-token', '203.0.113.7')).resolves.toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('secret = chaîne vide → considéré désactivé → true', async () => {
    process.env.TURNSTILE_SECRET_KEY = ''
    await expect(verifyTurnstile('un-token', '203.0.113.7')).resolves.toBe(true)
  })
})

describe('verifyTurnstile — CAPTCHA activé (clé secrète présente)', () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = '0xSECRET'
  })

  it('token absent → false sans aucun appel réseau', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(verifyTurnstile(undefined, '203.0.113.7')).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('challenge réussi (success:true) → true, avec la bonne requête', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true, json: async () => ({ success: true }) }))

    await expect(verifyTurnstile('tok-ok', '203.0.113.7')).resolves.toBe(true)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(SITEVERIFY_URL)
    expect(opts.method).toBe('POST')
    expect(opts.cache).toBe('no-store') // une vérif anti-bot ne se met pas en cache
    const body = opts.body as URLSearchParams
    expect(body.get('secret')).toBe('0xSECRET')
    expect(body.get('response')).toBe('tok-ok')
  })

  it('IP connue → transmet remoteip à Cloudflare', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true, json: async () => ({ success: true }) }))

    await verifyTurnstile('tok', '203.0.113.7')
    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.get('remoteip')).toBe('203.0.113.7')
  })

  it('IP « inconnue » → n’envoie pas remoteip', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true, json: async () => ({ success: true }) }))

    await verifyTurnstile('tok', 'inconnue')
    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.has('remoteip')).toBe(false)
  })

  it('IP vide → n’envoie pas remoteip', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true, json: async () => ({ success: true }) }))

    await verifyTurnstile('tok', '')
    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.has('remoteip')).toBe(false)
  })

  it('challenge échoué (success:false) → false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeResponse({ ok: true, json: async () => ({ success: false }) }),
    )
    await expect(verifyTurnstile('tok-ko', '203.0.113.7')).resolves.toBe(false)
  })

  it('réponse sans champ success → false (comparaison stricte à true)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeResponse({ ok: true, json: async () => ({}) }),
    )
    await expect(verifyTurnstile('tok', '203.0.113.7')).resolves.toBe(false)
  })

  it('HTTP non-2xx (res.ok=false) → false sans même lire le corps', async () => {
    const jsonSpy = vi.fn(async () => ({ success: true }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: false, json: jsonSpy }))
    await expect(verifyTurnstile('tok', '203.0.113.7')).resolves.toBe(false)
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('fetch rejette (réseau HS) → false + log d’erreur (fail-closed)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(verifyTurnstile('tok', '203.0.113.7')).resolves.toBe(false)
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(String(errSpy.mock.calls[0][0])).toContain('[turnstile]')
  })

  it('json() rejette (corps illisible) → false (fail-closed)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fakeResponse({
        ok: true,
        json: async () => {
          throw new Error('JSON invalide')
        },
      }),
    )
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(verifyTurnstile('tok', '203.0.113.7')).resolves.toBe(false)
    expect(errSpy).toHaveBeenCalled()
  })
})
