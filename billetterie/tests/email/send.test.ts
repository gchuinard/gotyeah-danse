// Transport e-mail générique (lib/email/send.ts) — Brevo si BREVO_API_KEY est
// présente, log console sinon. Module 100 % autonome (aucun import : ni DB, ni
// react-email), donc on ne mocke QUE le réseau (global.fetch) et les env.
//
// Garanties testées :
//  • ne jette JAMAIS — un mail raté ne doit pas faire échouer la réservation ;
//  • sans clé → mode dev : log « [email dev] … » (adresse + sujet), aucun fetch ;
//  • avec clé → POST Brevo (succès / échec HTTP / rejet réseau) ;
//  • le CORPS du mail (htmlContent) n'apparaît JAMAIS dans un log.
//
// Piège Node : affecter `undefined` à process.env.X écrit la chaîne "undefined"
// → pour le cas « non défini » il faut `delete process.env.X`.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { sendEmail } from '@/lib/email/send'

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'

let apiKeyBackup: string | undefined
let senderNameBackup: string | undefined
let senderAddressBackup: string | undefined

beforeAll(() => {
  apiKeyBackup = process.env.BREVO_API_KEY
  senderNameBackup = process.env.EMAIL_SENDER_NAME
  senderAddressBackup = process.env.EMAIL_SENDER_ADDRESS
})

beforeEach(() => {
  // État neutre par défaut : aucune clé → mode dev (log, pas de réseau).
  delete process.env.BREVO_API_KEY
  delete process.env.EMAIL_SENDER_NAME
  delete process.env.EMAIL_SENDER_ADDRESS
})

afterEach(() => {
  // Restaure l'env réel et défait les espions (fetch, console.*).
  restoreEnv('BREVO_API_KEY', apiKeyBackup)
  restoreEnv('EMAIL_SENDER_NAME', senderNameBackup)
  restoreEnv('EMAIL_SENDER_ADDRESS', senderAddressBackup)
  vi.restoreAllMocks()
})

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

// Réponse fetch factice (assez proche d'un Response pour le code testé : il ne
// lit que `ok` et `status`, jamais le corps).
function fakeResponse(init: { ok: boolean; status?: number }): Response {
  return { ok: init.ok, status: init.status ?? (init.ok ? 200 : 500) } as unknown as Response
}

// Corps HTML « secret » : sert à prouver qu'il ne fuite jamais dans les logs.
const SECRET_HTML = '<p>SECRET-CORPS-DU-MAIL-12345</p>'
const mail = {
  to: 'destinataire@exemple.fr',
  toName: 'Marie Dupont',
  subject: 'Vos billets — Gala 2026',
  html: SECRET_HTML,
}

// Concatène tous les arguments de tous les appels d'un espion en une chaîne,
// pour vérifier (présence / absence) sans dépendre de l'arité exacte du log.
function tousLesArgs(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.flat().map(String).join(' ')
}

describe('sendEmail — mode dev (sans BREVO_API_KEY)', () => {
  it('sans clé → renvoie true (succès simulé, jamais d’échec)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(sendEmail(mail)).resolves.toBe(true)
  })

  it('sans clé → logue « [email dev] » (adresse + sujet) et n’appelle JAMAIS le réseau', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await sendEmail(mail)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    const ligne = String(logSpy.mock.calls[0][0])
    expect(ligne).toContain('[email dev]')
    expect(ligne).toContain(mail.to)
    expect(ligne).toContain(mail.subject)
  })

  it('sans clé → n’écrit JAMAIS le corps du mail dans les logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendEmail(mail)
    expect(tousLesArgs(logSpy)).not.toContain('SECRET-CORPS-DU-MAIL')
  })

  it('clé = chaîne vide → considérée absente → mode dev (aucun réseau)', async () => {
    process.env.BREVO_API_KEY = ''
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(sendEmail(mail)).resolves.toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
  })
})

describe('sendEmail — transport Brevo (clé présente) — succès', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'xkeysib-TEST'
  })

  it('HTTP 2xx (res.ok) → true, un seul POST vers l’API Brevo', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true }))

    await expect(sendEmail(mail)).resolves.toBe(true)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(BREVO_URL)
    expect(opts.method).toBe('POST')
  })

  it('en-têtes : api-key + content-type/accept JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true }))

    await sendEmail(mail)

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['api-key']).toBe('xkeysib-TEST')
    expect(headers['content-type']).toBe('application/json')
    expect(headers.accept).toBe('application/json')
  })

  it('corps : destinataire (email + name), sujet et htmlContent transmis à Brevo', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true }))

    await sendEmail(mail)

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))
    expect(body.to).toEqual([{ email: mail.to, name: mail.toName }])
    expect(body.subject).toBe(mail.subject)
    expect(body.htmlContent).toBe(mail.html)
  })

  it('toName omis → pas de champ « name » dans le destinataire', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true }))

    await sendEmail({ to: 'simple@exemple.fr', subject: 'Sujet', html: '<p>h</p>' })

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))
    expect(body.to).toEqual([{ email: 'simple@exemple.fr' }])
    expect(body.to[0]).not.toHaveProperty('name')
  })

  it('expéditeur par défaut quand EMAIL_SENDER_* absent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true }))

    await sendEmail(mail)

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))
    expect(body.sender.name).toBe('École de danse Desha-Moulin')
    expect(body.sender.email).toBe('billetterie@cours-danse-bergerac.fr')
  })

  it('expéditeur personnalisé via EMAIL_SENDER_NAME / EMAIL_SENDER_ADDRESS', async () => {
    process.env.EMAIL_SENDER_NAME = 'Gala Desha-Moulin'
    process.env.EMAIL_SENDER_ADDRESS = 'gala@exemple.fr'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true }))

    await sendEmail(mail)

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))
    expect(body.sender.name).toBe('Gala Desha-Moulin')
    expect(body.sender.email).toBe('gala@exemple.fr')
  })

  it('succès → aucun log d’erreur', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendEmail(mail)

    expect(errSpy).not.toHaveBeenCalled()
  })
})

describe('sendEmail — transport Brevo — échec HTTP', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'xkeysib-TEST'
  })

  it('HTTP non-2xx (res.ok=false) → false, sans jeter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendEmail(mail)).resolves.toBe(false)
  })

  it('échec HTTP → log d’erreur avec le code HTTP + le destinataire, mais JAMAIS le corps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: false, status: 422 }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendEmail(mail)

    expect(errSpy).toHaveBeenCalledTimes(1)
    const journal = tousLesArgs(errSpy)
    expect(journal).toContain('[email]')
    expect(journal).toContain('422')
    expect(journal).toContain(mail.to)
    expect(journal).not.toContain('SECRET-CORPS-DU-MAIL')
  })
})

describe('sendEmail — transport Brevo — échec réseau (fetch rejette)', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'xkeysib-TEST'
  })

  it('fetch rejette → false, AUCUNE exception ne remonte (ne jette jamais)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendEmail(mail)).resolves.toBe(false)
  })

  it('échec réseau → log d’erreur « réseau », sans le corps du mail', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendEmail(mail)

    expect(errSpy).toHaveBeenCalledTimes(1)
    const journal = tousLesArgs(errSpy)
    expect(journal).toContain('[email]')
    expect(journal).toContain('réseau')
    expect(journal).toContain(mail.to)
    expect(journal).not.toContain('SECRET-CORPS-DU-MAIL')
  })

  it('rejet non-Error (string brute) → false sans jeter (branche err non-Error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('panne brutale')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendEmail(mail)).resolves.toBe(false)
    expect(errSpy).toHaveBeenCalledTimes(1)
  })
})
