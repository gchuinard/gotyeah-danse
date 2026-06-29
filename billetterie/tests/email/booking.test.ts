// E-mails métier de réservation (lib/email/booking.ts).
//
// On NE part JAMAIS sur le réseau : le transport `sendEmail` (lib/email/send.ts)
// est entièrement mocké — aucun e-mail réel, aucune clé Brevo requise. Chaque
// fonction rend un vrai template react-email puis délègue l'envoi : on capture
// l'argument passé à `sendEmail` et on assert sur le HTML rendu (nom, identifiant
// de demande, lien /billets/<token>, QR codes…) + le sujet et le destinataire.
//
// Piège Node : affecter `undefined` à process.env.X écrit la chaîne "undefined"
// → pour le cas « env absente » il faut `delete process.env.APP_BASE_URL`.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` est hoisté en tête de fichier : la fabrique du mock doit donc passer
// par `vi.hoisted` (sinon « Cannot access … before initialization »).
const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendEmail: sendEmailMock }))

import { codeDemande } from '@/lib/booking/code'
import {
  type BookingBillets,
  sendBookingPendingEmail,
  sendCancelledEmail,
  sendMovedEmail,
  sendReminderEmail,
  sendTicketsEmail,
} from '@/lib/email/booking'

// Forme de l'argument capté côté transport (lib/email/send.ts).
type Envoi = { to: string; toName?: string; subject: string; html: string }

const BASE = 'https://billets.test'

// startsAt en UTC choisie pour donner 20h30 à Paris (heure d'été = UTC+2) →
// vérifie au passage le formatage français « samedi 27 juin 2026 à 20h30 ».
const STARTS_AT = new Date('2026-06-27T18:30:00Z')
const DATE_FR = 'samedi 27 juin 2026 à 20h30'
const representation = { title: 'Samedi 20h30', startsAt: STARTS_AT }

// Dernier (ou unique) envoi capturé.
function dernierEnvoi(): Envoi {
  const { calls } = sendEmailMock.mock
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0] as Envoi
}

function billets(tickets: BookingBillets['tickets']): BookingBillets {
  return {
    name: 'Marie Dupont',
    email: 'marie@exemple.fr',
    publicToken: 'tok-public-123',
    representation,
    tickets,
  }
}

const billet = (qrToken: string, number: number, label: string, section: string) => ({
  qrToken,
  seat: { number, row: { label, section: { name: section } } },
})

let baseUrlBackup: string | undefined

beforeAll(() => {
  baseUrlBackup = process.env.APP_BASE_URL
})

beforeEach(() => {
  process.env.APP_BASE_URL = BASE
  // Repart d'un transport neuf qui « réussit » par défaut.
  sendEmailMock.mockReset()
  sendEmailMock.mockResolvedValue(true)
})

afterAll(() => {
  if (baseUrlBackup === undefined) delete process.env.APP_BASE_URL
  else process.env.APP_BASE_URL = baseUrlBackup
})

describe('sendBookingPendingEmail — « demande enregistrée »', () => {
  const demande = {
    name: 'Marie Dupont',
    email: 'marie@exemple.fr',
    partySize: 3,
    publicToken: 'tok-public-123',
    expiresAt: new Date('2026-07-10T12:00:00Z'),
    representation,
  }

  it('envoie un seul e-mail, au nom + adresse du demandeur', async () => {
    const ok = await sendBookingPendingEmail(demande)
    expect(ok).toBe(true)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const { to, toName } = dernierEnvoi()
    expect(to).toBe('marie@exemple.fr')
    expect(toName).toBe('Marie Dupont')
  })

  it('sujet : « Votre demande de places — <titre> »', async () => {
    await sendBookingPendingEmail(demande)
    expect(dernierEnvoi().subject).toBe('Votre demande de places — Samedi 20h30')
  })

  it('corps : nombre de places, titre et date FR (Europe/Paris)', async () => {
    await sendBookingPendingEmail(demande)
    const { html } = dernierEnvoi()
    expect(html).toContain('3 places')
    expect(html).toContain('Samedi 20h30')
    expect(html).toContain(DATE_FR)
  })

  it('contient l’identifiant de demande dérivé du token (codeDemande)', async () => {
    await sendBookingPendingEmail(demande)
    const { html } = dernierEnvoi()
    const code = codeDemande('tok-public-123')
    // Alphabet sans ambiguïté (ni I/L/O/0/1), 6 caractères.
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(html).toContain('identifiant de demande')
    expect(html).toContain(code)
  })

  it('contient le lien de suivi /billets/<token> (URL absolue)', async () => {
    await sendBookingPendingEmail(demande)
    expect(dernierEnvoi().html).toContain(`${BASE}/billets/tok-public-123`)
  })

  it('avec date d’expiration → date limite FR (jour seul, sans heure)', async () => {
    await sendBookingPendingEmail(demande)
    expect(dernierEnvoi().html).toContain('vendredi 10 juillet 2026')
  })

  it('sans date d’expiration → délai générique « 14 jours »', async () => {
    await sendBookingPendingEmail({ ...demande, expiresAt: null })
    expect(dernierEnvoi().html).toContain('la fin du délai de 14 jours')
  })

  it('partySize = 1 → « 1 place » au singulier', async () => {
    await sendBookingPendingEmail({ ...demande, partySize: 1 })
    const { html } = dernierEnvoi()
    expect(html).toContain('<strong>1 place</strong>')
    expect(html).not.toContain('1 places')
  })
})

describe('sendReminderEmail — « petit rappel » (relance J+7)', () => {
  const rappel = {
    name: 'Marie Dupont',
    email: 'marie@exemple.fr',
    partySize: 2,
    publicToken: 'tok-rem',
    expiresAt: new Date('2026-07-10T12:00:00Z'),
    representation,
  }

  it('sujet : « Rappel : votre demande de places — <titre> »', async () => {
    await sendReminderEmail(rappel)
    expect(dernierEnvoi().subject).toBe('Rappel : votre demande de places — Samedi 20h30')
  })

  it('titre du mail « Petit rappel » + lien de suivi /billets/<token>', async () => {
    await sendReminderEmail(rappel)
    const { html } = dernierEnvoi()
    expect(html).toContain('Petit rappel')
    expect(html).toContain(`${BASE}/billets/tok-rem`)
  })

  it('corps : places, titre et date FR', async () => {
    await sendReminderEmail(rappel)
    const { html } = dernierEnvoi()
    expect(html).toContain('2 places')
    expect(html).toContain(DATE_FR)
  })

  it('ne montre PAS d’identifiant de demande (réservé au mail initial)', async () => {
    await sendReminderEmail(rappel)
    expect(dernierEnvoi().html).not.toContain('identifiant de demande')
  })

  it('sans date d’expiration → délai générique « 14 jours »', async () => {
    await sendReminderEmail({ ...rappel, expiresAt: null })
    expect(dernierEnvoi().html).toContain('la fin du délai de 14 jours')
  })
})

describe('sendTicketsEmail — « Vos billets » (places attribuées)', () => {
  const deuxBillets = billets([
    billet('qr-1', 12, 'D', 'Centre'),
    billet('qr-2', 13, 'D', 'Centre'),
  ])

  it('sujet : « Vos billets — <titre> »', async () => {
    await sendTicketsEmail(deuxBillets)
    expect(dernierEnvoi().subject).toBe('Vos billets — Samedi 20h30')
  })

  it('un bloc placement par billet (section · rang · place)', async () => {
    await sendTicketsEmail(deuxBillets)
    const { html } = dernierEnvoi()
    expect(html).toContain('Centre')
    expect(html).toContain('Rang <strong>D</strong>')
    expect(html).toContain('Place <strong>12</strong>')
    expect(html).toContain('Place <strong>13</strong>')
  })

  it('une URL de QR par billet, servie par /api/qr/<token>.png', async () => {
    await sendTicketsEmail(deuxBillets)
    const { html } = dernierEnvoi()
    expect(html).toContain(`${BASE}/api/qr/qr-1.png`)
    expect(html).toContain(`${BASE}/api/qr/qr-2.png`)
    // react-email précharge chaque image (<link rel="preload"> + <img src>) :
    // on compte donc les URLs DISTINCTES (une par billet), pas les occurrences.
    const qrUrls = html.match(/\/api\/qr\/[a-z0-9-]+\.png/g) ?? []
    expect(new Set(qrUrls).size).toBe(2)
  })

  it('contient le lien de suivi /billets/<token>', async () => {
    await sendTicketsEmail(deuxBillets)
    expect(dernierEnvoi().html).toContain(`${BASE}/billets/tok-public-123`)
  })

  it('2 billets → « 2 places » au pluriel', async () => {
    await sendTicketsEmail(deuxBillets)
    expect(dernierEnvoi().html).toContain('2 places')
  })

  it('1 seul billet → « 1 place » au singulier', async () => {
    await sendTicketsEmail(billets([billet('qr-solo', 7, 'B', 'Gauche')]))
    const { html } = dernierEnvoi()
    expect(html).toContain('<strong>1 place</strong>')
    expect(html).not.toContain('1 places')
  })
})

describe('sendMovedEmail — « Vos places ont été modifiées »', () => {
  const deplacement = billets([
    billet('qr-9', 4, 'F', 'Gauche'),
    billet('qr-10', 5, 'F', 'Gauche'),
  ])

  it('sujet : « Vos places ont été modifiées — <titre> »', async () => {
    await sendMovedEmail(deplacement)
    expect(dernierEnvoi().subject).toBe('Vos places ont été modifiées — Samedi 20h30')
  })

  it('avertit que les anciens billets/QR ne sont plus valables', async () => {
    await sendMovedEmail(deplacement)
    expect(dernierEnvoi().html).toContain('ne sont plus valables')
  })

  it('présente les NOUVEAUX QR codes + leur placement', async () => {
    await sendMovedEmail(deplacement)
    const { html } = dernierEnvoi()
    expect(html).toContain(`${BASE}/api/qr/qr-9.png`)
    expect(html).toContain(`${BASE}/api/qr/qr-10.png`)
    expect(html).toContain('Place <strong>4</strong>')
  })

  it('contient le lien de suivi /billets/<token>', async () => {
    await sendMovedEmail(deplacement)
    expect(dernierEnvoi().html).toContain(`${BASE}/billets/tok-public-123`)
  })
})

describe('sendCancelledEmail — « Votre demande a été annulée »', () => {
  const annulation = {
    name: 'Marie Dupont',
    email: 'marie@exemple.fr',
    partySize: 2,
    representation,
  }

  it('sujet : « Votre demande a été annulée — <titre> »', async () => {
    await sendCancelledEmail(annulation)
    expect(dernierEnvoi().subject).toBe('Votre demande a été annulée — Samedi 20h30')
  })

  it('propose de refaire une demande, vers le formulaire (URL de base nue)', async () => {
    await sendCancelledEmail(annulation)
    const { html } = dernierEnvoi()
    expect(html).toContain('Refaire une demande')
    expect(html).toContain(`href="${BASE}"`)
  })

  it('aucun billet ici : ni lien /billets/ ni QR code', async () => {
    await sendCancelledEmail(annulation)
    const { html } = dernierEnvoi()
    expect(html).not.toContain('/billets/')
    expect(html).not.toContain('/api/qr/')
  })

  it('rappelle le nombre de places concernées', async () => {
    await sendCancelledEmail(annulation)
    expect(dernierEnvoi().html).toContain('2 places')
  })
})

describe('URL de base (APP_BASE_URL)', () => {
  const demande = {
    name: 'Marie Dupont',
    email: 'marie@exemple.fr',
    partySize: 2,
    publicToken: 'tok-public-123',
    expiresAt: null,
    representation,
  }

  it('env absente → repli sur http://localhost:3000', async () => {
    delete process.env.APP_BASE_URL
    await sendBookingPendingEmail(demande)
    expect(dernierEnvoi().html).toContain('http://localhost:3000/billets/tok-public-123')
  })

  it('env définie → toutes les URLs (suivi + QR) utilisent cette base', async () => {
    process.env.APP_BASE_URL = 'https://prod.exemple'
    await sendTicketsEmail(billets([billet('qr-x', 1, 'A', 'Centre')]))
    const { html } = dernierEnvoi()
    expect(html).toContain('https://prod.exemple/billets/tok-public-123')
    expect(html).toContain('https://prod.exemple/api/qr/qr-x.png')
  })
})

describe('robustesse du transport (jamais de réseau réel)', () => {
  const demande = {
    name: 'Marie Dupont',
    email: 'marie@exemple.fr',
    partySize: 1,
    publicToken: 'tok-public-123',
    expiresAt: null,
    representation,
  }

  it('transport OK → la fonction retourne true', async () => {
    sendEmailMock.mockResolvedValue(true)
    await expect(sendBookingPendingEmail(demande)).resolves.toBe(true)
  })

  it('transport en échec → propage false (la réservation, elle, n’échoue pas)', async () => {
    sendEmailMock.mockResolvedValue(false)
    await expect(sendBookingPendingEmail(demande)).resolves.toBe(false)
  })

  it('le HTML envoyé est une vraie page (rendu react-email, non vide)', async () => {
    await sendBookingPendingEmail(demande)
    const { html } = dernierEnvoi()
    expect(html).toContain('<!DOCTYPE')
    expect(html.length).toBeGreaterThan(500)
  })
})
