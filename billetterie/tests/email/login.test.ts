// E-mail « code de connexion » admin (lib/email/login.ts).
//
// sendLoginCodeEmail() rend le template react-email emails/login-code et passe
// le HTML à sendEmail() (lib/email/send.ts). On teste la CHAÎNE RÉELLE (login →
// send) en ne mockant QUE le transport réseau : global.fetch. Selon BREVO_API_KEY :
//   - clé présente  → POST Brevo (on inspecte le corps : sujet, expéditeur,
//                     destinataire, HTML rendu contenant le code) ;
//   - clé absente/vide → mode dev : aucun réseau, sendEmail logge, et login.ts
//                     logge le code en clair (sinon impossible de se connecter
//                     en local).
// Aucun e-mail réel, aucune dépendance à une vraie clé (fetch est espionné).
// Piège Node : affecter `undefined` à process.env.X écrit la chaîne "undefined"
// → pour le cas « non défini » il faut `delete process.env.X`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sendLoginCodeEmail } from '@/lib/email/login'

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'
const CODE = '042713' // OTP à 6 chiffres
const DEST = 'admin@exemple.fr'

// Sujet et expéditeur par défaut — recopiés verbatim du code de prod.
const SUJET = 'Votre code de connexion — Billetterie'
const SENDER_NAME_DEFAUT = 'École de danse Desha-Moulin'
const SENDER_EMAIL_DEFAUT = 'billetterie@cours-danse-bergerac.fr'

const ENV_KEYS = ['BREVO_API_KEY', 'EMAIL_SENDER_NAME', 'EMAIL_SENDER_ADDRESS'] as const
let envBackup: Record<string, string | undefined> = {}

beforeEach(() => {
  // Sauvegarde puis neutralise : état de départ = mode dev (aucune clé).
  envBackup = {}
  for (const k of ENV_KEYS) {
    envBackup[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) restoreEnv(k, envBackup[k])
  vi.restoreAllMocks() // défait fetch / console
})

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

// Réponse fetch factice : send.ts ne lit que res.ok et res.status.
function fakeResponse(init: { ok: boolean; status?: number }): Response {
  return { ok: init.ok, status: init.status ?? (init.ok ? 201 : 500) } as unknown as Response
}

// Corps JSON du POST envoyé à Brevo (1er appel fetch).
interface CorpsBrevo {
  sender: { name: string; email: string }
  to: Array<{ email: string; name?: string }>
  subject: string
  htmlContent: string
}
function corpsBrevo(fetchSpy: ReturnType<typeof vi.spyOn>): CorpsBrevo {
  const opts = fetchSpy.mock.calls[0][1] as RequestInit
  return JSON.parse(opts.body as string) as CorpsBrevo
}

describe('sendLoginCodeEmail — transport Brevo (clé factice, fetch mocké)', () => {
  beforeEach(() => {
    // Clé factice : active le chemin Brevo de send.ts. fetch étant espionné,
    // aucun appel réel — la valeur de la clé n'a aucune importance.
    process.env.BREVO_API_KEY = 'cle-factice-de-test'
  })

  it('appelle Brevo une seule fois, sur la bonne URL en POST', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true }))

    await sendLoginCodeEmail(DEST, CODE)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(BREVO_URL)
    expect(opts.method).toBe('POST')
  })

  it('transmet la clé via l’en-tête api-key, en JSON', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true }))

    await sendLoginCodeEmail(DEST, CODE)

    const opts = fetchSpy.mock.calls[0][1] as RequestInit
    const headers = opts.headers as Record<string, string>
    expect(headers['api-key']).toBe('cle-factice-de-test')
    expect(headers['content-type']).toBe('application/json')
  })

  it('le code à 6 chiffres apparaît dans le HTML rendu', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true }))

    await sendLoginCodeEmail(DEST, CODE)

    const corps = corpsBrevo(fetchSpy)
    expect(corps.htmlContent).toContain(CODE)
    // …et c'est bien le bon template (texte stable du login-code).
    expect(corps.htmlContent).toContain('code de connexion')
  })

  it('le sujet est exactement le libellé de connexion', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true }))

    await sendLoginCodeEmail(DEST, CODE)

    expect(corpsBrevo(fetchSpy).subject).toBe(SUJET)
  })

  it('le destinataire est l’adresse passée', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true }))

    await sendLoginCodeEmail(DEST, CODE)

    expect(corpsBrevo(fetchSpy).to[0].email).toBe(DEST)
  })

  it('expéditeur par défaut (école Desha-Moulin) sans variable d’env', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true }))

    await sendLoginCodeEmail(DEST, CODE)

    const { sender } = corpsBrevo(fetchSpy)
    expect(sender.name).toBe(SENDER_NAME_DEFAUT)
    expect(sender.email).toBe(SENDER_EMAIL_DEFAUT)
  })

  it('expéditeur surchargé par EMAIL_SENDER_NAME / EMAIL_SENDER_ADDRESS', async () => {
    process.env.EMAIL_SENDER_NAME = 'Billetterie Test'
    process.env.EMAIL_SENDER_ADDRESS = 'no-reply@test.local'
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true }))

    await sendLoginCodeEmail(DEST, CODE)

    const { sender } = corpsBrevo(fetchSpy)
    expect(sender.name).toBe('Billetterie Test')
    expect(sender.email).toBe('no-reply@test.local')
  })

  it('renvoie true quand Brevo répond 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true, status: 201 }))
    await expect(sendLoginCodeEmail(DEST, CODE)).resolves.toBe(true)
  })

  it('renvoie false (sans jeter) quand Brevo répond non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: false, status: 422 }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendLoginCodeEmail(DEST, CODE)).resolves.toBe(false)
    expect(errSpy).toHaveBeenCalled()
  })

  it('renvoie false (sans jeter) quand le réseau échoue', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendLoginCodeEmail(DEST, CODE)).resolves.toBe(false)
    expect(errSpy).toHaveBeenCalled()
  })

  it('sécurité : clé présente → ne logge JAMAIS le code en clair', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse({ ok: true }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await sendLoginCodeEmail(DEST, CODE)

    const messages = logSpy.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes(CODE))).toBe(false)
  })

  it('le HTML rendu suit le code passé (deux codes distincts → deux HTML)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse({ ok: true }))

    await sendLoginCodeEmail(DEST, '111111')
    await sendLoginCodeEmail(DEST, '999999')

    const html1 = (JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as CorpsBrevo).htmlContent
    const html2 = (JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string) as CorpsBrevo).htmlContent
    expect(html1).toContain('111111')
    expect(html1).not.toContain('999999')
    expect(html2).toContain('999999')
  })
})

describe('sendLoginCodeEmail — mode dev (sans BREVO_API_KEY)', () => {
  it('renvoie true sans aucun appel réseau', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    vi.spyOn(console, 'log').mockImplementation(() => {}) // silence les logs dev

    await expect(sendLoginCodeEmail(DEST, CODE)).resolves.toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('logge le code en clair (et l’adresse) pour permettre la connexion locale', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await sendLoginCodeEmail(DEST, CODE)

    const messages = logSpy.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes(CODE) && m.includes(DEST))).toBe(true)
  })

  it('clé vide ("") est traitée comme absente → mode dev (pas de réseau)', async () => {
    process.env.BREVO_API_KEY = '' // chaîne vide = falsy = mode dev
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(sendLoginCodeEmail(DEST, CODE)).resolves.toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    // le code reste loggé pour le dev même avec BREVO_API_KEY=""
    expect(logSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes(CODE))).toBe(true)
  })
})
