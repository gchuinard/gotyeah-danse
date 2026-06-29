// Création d'une demande « en attente », sur une DB SQLite ISOLÉE ET JETABLE
// dans /tmp (même pattern que tests/booking/place.test.ts).
//
// ⚠️ creer.ts utilise le prisma GLOBAL (import { prisma } from '@/lib/db',
// instancié À L'IMPORT depuis DATABASE_URL). On le détourne vers la base
// jetable en réglant process.env.DATABASE_URL AVANT tout import de @/lib/db,
// puis en important le module DYNAMIQUEMENT dans beforeAll. Aucun import de
// valeur depuis creer.ts en tête de fichier (seulement des `import type`,
// effacés au build) → on ne touche JAMAIS prisma/dev.db.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { NouvelleDemande } from '@/lib/booking/creer'

// Nom UNIQUE (creer + pid) → zéro collision avec les autres tests / agents qui
// tournent EN MÊME TEMPS.
const dbFile = `/tmp/billetterie-test-creer-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// On détourne le client global vers la base jetable AVANT son instanciation, et
// on force le mode « dev » de l'e-mail (best effort) → console.log, jamais de
// réseau.
process.env.DATABASE_URL = url
delete process.env.BREVO_API_KEY

// Plan FIXE (semé une fois) : computeJauge compte db.seat.count() GLOBALEMENT,
// donc la capacité d'une représentation vide = nombre total de sièges.
const CAPACITE = 10
const ACTOR = 'benevole@ecole.fr'

let prisma: PrismaClient
let creer: typeof import('@/lib/booking/creer').creerBookingEnAttente
let chercherDoublons: typeof import('@/lib/booking/creer').chercherDoublonsDemande
let computeJauge: typeof import('@/lib/jauge').computeJauge

// Compteur monotone → emails / tokens uniques (publicToken est @unique).
let seq = 0
const uid = () => `${++seq}`

// Construit une NouvelleDemande complète (representationId à fournir par test).
function demande(over: Partial<NouvelleDemande> = {}): NouvelleDemande {
  return {
    representationId: '',
    name: 'Famille Test',
    email: 'famille@exemple.fr',
    phone: '06 12 34 56 78',
    partySize: 2,
    ...over,
  }
}

function champs(over: Partial<{ email: string; phone: string; lastName: string }> = {}) {
  return { email: 'inconnu@exemple.fr', phone: '', lastName: '', ...over }
}

async function creerRep(data: Record<string, unknown> = {}) {
  return prisma.representation.create({
    data: {
      title: 'Samedi 20h30',
      startsAt: new Date('2026-06-27T18:30:00Z'),
      isOpen: true,
      ...data,
    },
  })
}

// Demande semée EN DIRECT (sans passer par creer) : doublons / remplissage de jauge.
async function seedBooking(representationId: string, data: Record<string, unknown> = {}) {
  return prisma.booking.create({
    data: {
      representationId,
      name: 'Témoin',
      email: `temoin-${uid()}@exemple.fr`,
      phone: '0600000000',
      partySize: 1,
      status: 'pending',
      publicToken: `tok-${uid()}`,
      ...data,
    },
  })
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  // Imports DYNAMIQUES : @/lib/db lit DATABASE_URL ICI → base jetable. La même
  // instance singleton est partagée par creer.ts (modules ESM = singletons).
  prisma = (await import('@/lib/db')).prisma
  const mod = await import('@/lib/booking/creer')
  creer = mod.creerBookingEnAttente
  chercherDoublons = mod.chercherDoublonsDemande
  computeJauge = (await import('@/lib/jauge')).computeJauge

  await prisma.section.create({ data: { id: 'centre', name: 'Centre', order: 1 } })
  await prisma.row.create({ data: { id: 'centre-A', sectionId: 'centre', label: 'A', order: 0 } })
  for (let i = 0; i < CAPACITE; i++) {
    const n = String(i + 1).padStart(2, '0')
    await prisma.seat.create({
      data: { id: `centre-A-${n}`, rowId: 'centre-A', number: i + 1, indexInRow: i, x: 0, y: 0, angle: 0 },
    })
  }
}, 60_000)

// Remise à zéro du dynamique entre chaque test (ordre FK). Le plan reste intact.
beforeEach(async () => {
  await prisma.ticket.deleteMany()
  await prisma.bookingEvent.deleteMany()
  await prisma.seatOverride.deleteMany()
  await prisma.booking.deleteMany()
  await prisma.representation.deleteMany()
  seq = 0
})

afterAll(async () => {
  await prisma.$disconnect()
  for (const suffix of ['', '-journal']) rmSync(dbFile + suffix, { force: true })
})

describe('creerBookingEnAttente', () => {
  it('crée une demande « pending » et renvoie le publicToken + le titre (écrit bien dans la base jetable)', async () => {
    const rep = await creerRep({ title: 'Vendredi 20h30' })
    const res = await creer(demande({ representationId: rep.id, partySize: 2 }), ACTOR)
    if (!('booking' in res)) throw new Error('succès attendu')

    expect(res.booking.publicToken).toBeTruthy()
    expect(res.representationTitle).toBe('Vendredi 20h30')

    // Relecture via le MÊME client global → prouve la persistance en base jetable.
    const stored = await prisma.booking.findUniqueOrThrow({
      where: { publicToken: res.booking.publicToken },
    })
    expect(stored.status).toBe('pending')
    expect(stored.representationId).toBe(rep.id)
    expect(stored.partySize).toBe(2)
    expect(stored.email).toBe('famille@exemple.fr')
    expect(await prisma.booking.count()).toBe(1)
  })

  it('consomme la jauge à hauteur du partySize', async () => {
    const rep = await creerRep()
    expect(await computeJauge(prisma, rep.id)).toBe(CAPACITE)
    const res = await creer(demande({ representationId: rep.id, partySize: 3 }), ACTOR)
    expect('booking' in res).toBe(true)
    expect(await computeJauge(prisma, rep.id)).toBe(CAPACITE - 3)
  })

  it('normalise l’email (trim + minuscules) avant stockage', async () => {
    const rep = await creerRep()
    const res = await creer(demande({ representationId: rep.id, email: '  Famille@EXEMPLE.Fr  ' }), ACTOR)
    if (!('booking' in res)) throw new Error('succès attendu')
    const stored = await prisma.booking.findUniqueOrThrow({ where: { publicToken: res.booking.publicToken } })
    expect(stored.email).toBe('famille@exemple.fr')
  })

  it('borne childCount à partySize (et plancher 0)', async () => {
    const repA = await creerRep()
    const trop = await creer(
      demande({ representationId: repA.id, partySize: 2, childCount: 5, email: 'a@exemple.fr' }),
      ACTOR,
    )
    if (!('booking' in trop)) throw new Error('succès attendu')
    expect((await prisma.booking.findUniqueOrThrow({ where: { publicToken: trop.booking.publicToken } })).childCount).toBe(2)

    const repB = await creerRep()
    const neg = await creer(
      demande({ representationId: repB.id, partySize: 3, childCount: -4, email: 'b@exemple.fr' }),
      ACTOR,
    )
    if (!('booking' in neg)) throw new Error('succès attendu')
    expect((await prisma.booking.findUniqueOrThrow({ where: { publicToken: neg.booking.publicToken } })).childCount).toBe(0)
  })

  it('borne pmrCount à partySize et pmrCompanions au reste (places non PMR)', async () => {
    const rep = await creerRep()
    const res = await creer(
      demande({ representationId: rep.id, partySize: 4, pmrCount: 1, pmrCompanions: 10, email: 'pmr@exemple.fr' }),
      ACTOR,
    )
    if (!('booking' in res)) throw new Error('succès attendu')
    const s = await prisma.booking.findUniqueOrThrow({ where: { publicToken: res.booking.publicToken } })
    expect(s.pmrCount).toBe(1)
    expect(s.pmrCompanions).toBe(3) // min(10, 4 − 1)
  })

  it('force pmrCompanions à 0 quand pmrCount = 0', async () => {
    const rep = await creerRep()
    const res = await creer(
      demande({ representationId: rep.id, partySize: 3, pmrCount: 0, pmrCompanions: 5, email: 'nopmr@exemple.fr' }),
      ACTOR,
    )
    if (!('booking' in res)) throw new Error('succès attendu')
    const s = await prisma.booking.findUniqueOrThrow({ where: { publicToken: res.booking.publicToken } })
    expect(s.pmrCount).toBe(0)
    expect(s.pmrCompanions).toBe(0)
  })

  it('notes : undefined → null en base ; valeur conservée sinon', async () => {
    const repA = await creerRep()
    const sans = await creer(demande({ representationId: repA.id, email: 'sans@exemple.fr' }), ACTOR)
    if (!('booking' in sans)) throw new Error('succès attendu')
    expect((await prisma.booking.findUniqueOrThrow({ where: { publicToken: sans.booking.publicToken } })).notes).toBeNull()

    const repB = await creerRep()
    const avec = await creer(
      demande({ representationId: repB.id, email: 'avec@exemple.fr', notes: 'Près de la sortie svp' }),
      ACTOR,
    )
    if (!('booking' in avec)) throw new Error('succès attendu')
    expect((await prisma.booking.findUniqueOrThrow({ where: { publicToken: avec.booking.publicToken } })).notes).toBe(
      'Près de la sortie svp',
    )
  })

  it('fixe expiresAt à ≈ +14 jours', async () => {
    const rep = await creerRep()
    const avant = Date.now()
    const res = await creer(demande({ representationId: rep.id, email: 'exp@exemple.fr' }), ACTOR)
    if (!('booking' in res)) throw new Error('succès attendu')
    const s = await prisma.booking.findUniqueOrThrow({ where: { publicToken: res.booking.publicToken } })
    expect(s.expiresAt).not.toBeNull()
    const J14 = 14 * 24 * 60 * 60 * 1000
    const delta = s.expiresAt!.getTime() - avant
    expect(delta).toBeGreaterThanOrEqual(J14 - 5000)
    expect(delta).toBeLessThanOrEqual(J14 + 5000)
  })

  it('journalise l’événement « created » avec l’auteur et le nombre de places (pluriel)', async () => {
    const rep = await creerRep()
    const res = await creer(demande({ representationId: rep.id, partySize: 3 }), 'benevole@ecole.fr')
    if (!('booking' in res)) throw new Error('succès attendu')
    const stored = await prisma.booking.findUniqueOrThrow({
      where: { publicToken: res.booking.publicToken },
      include: { events: true },
    })
    expect(stored.events).toHaveLength(1)
    expect(stored.events[0].action).toBe('created')
    expect(stored.events[0].adminEmail).toBe('benevole@ecole.fr')
    expect(stored.events[0].detail).toBe('3 places')
  })

  it('détail du journal au singulier pour une seule place', async () => {
    const rep = await creerRep()
    const res = await creer(demande({ representationId: rep.id, partySize: 1 }), ACTOR)
    if (!('booking' in res)) throw new Error('succès attendu')
    const stored = await prisma.booking.findUniqueOrThrow({
      where: { publicToken: res.booking.publicToken },
      include: { events: true },
    })
    expect(stored.events[0].detail).toBe('1 place')
  })

  it('refuse une représentation inexistante (aucune écriture)', async () => {
    const res = await creer(demande({ representationId: 'rep-fantome' }), ACTOR)
    if (!('error' in res)) throw new Error('erreur attendue')
    expect(res.error).toContain('pas ouverte')
    expect(res.dejaEnCours).toBeUndefined()
    expect(await prisma.booking.count()).toBe(0)
  })

  it('refuse une représentation fermée (isOpen = false)', async () => {
    const rep = await creerRep({ isOpen: false })
    const res = await creer(demande({ representationId: rep.id }), ACTOR)
    if (!('error' in res)) throw new Error('erreur attendue')
    expect(res.error).toContain('pas ouverte')
    expect(await prisma.booking.count()).toBe(0)
  })

  it('refuse si la jauge est insuffisante (et ne crée rien)', async () => {
    const rep = await creerRep()
    // Remplissage par un AUTRE email (sinon le blocage doublon précéderait la jauge).
    await seedBooking(rep.id, { partySize: 9, email: 'filler@exemple.fr', expiresAt: null })
    const res = await creer(demande({ representationId: rep.id, partySize: 2 }), ACTOR)
    if (!('error' in res)) throw new Error('erreur attendue')
    expect(res.error).toBe('Plus assez de places disponibles')
    expect(res.dejaEnCours).toBeUndefined()
    expect(await prisma.booking.count({ where: { email: 'famille@exemple.fr' } })).toBe(0)
  })

  it('accepte exactement la jauge restante (limite : jauge == partySize)', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, { partySize: 8, email: 'filler@exemple.fr', expiresAt: null })
    // jauge restante = 2, partySize = 2 → la condition de rejet est jauge < partySize.
    const res = await creer(demande({ representationId: rep.id, partySize: 2 }), ACTOR)
    expect('booking' in res).toBe(true)
    expect(await computeJauge(prisma, rep.id)).toBe(0)
  })

  it('bloque un doublon d’email tant qu’une demande « pending » est en cours (dejaEnCours)', async () => {
    const rep = await creerRep()
    const first = await creer(demande({ representationId: rep.id, email: 'famille@exemple.fr' }), ACTOR)
    if (!('booking' in first)) throw new Error('1re création attendue')
    // Même email à la casse près → bloqué.
    const second = await creer(
      demande({ representationId: rep.id, email: 'FAMILLE@Exemple.FR', partySize: 1 }),
      ACTOR,
    )
    if (!('error' in second)) throw new Error('blocage attendu')
    expect(second.dejaEnCours).toBe(true)
    expect(second.error).toContain('déjà en cours')
    expect(await prisma.booking.count({ where: { representationId: rep.id } })).toBe(1)
  })

  it('bloque un doublon d’email si une demande est déjà réglée (paid / placed)', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, { status: 'paid', email: 'regle@exemple.fr', partySize: 1 })
    const res = await creer(demande({ representationId: rep.id, email: 'Regle@Exemple.fr' }), ACTOR)
    if (!('error' in res)) throw new Error('blocage attendu')
    expect(res.dejaEnCours).toBe(true)
    expect(res.error).toContain('déjà réglée')
  })

  it('autorise si la seule demande existante est un « pending » EXPIRÉ (ni blocage ni jauge consommée)', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, {
      status: 'pending',
      email: 'famille@exemple.fr',
      partySize: 1,
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    })
    const res = await creer(demande({ representationId: rep.id, email: 'famille@exemple.fr', partySize: 2 }), ACTOR)
    if (!('booking' in res)) throw new Error('succès attendu (l’ancienne demande est expirée)')
    expect(res.booking.publicToken).toBeTruthy()
  })

  it('autorise si la demande existante est annulée (cancelled)', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, { status: 'cancelled', email: 'famille@exemple.fr', partySize: 1 })
    const res = await creer(demande({ representationId: rep.id, email: 'famille@exemple.fr' }), ACTOR)
    expect('booking' in res).toBe(true)
  })

  it('le blocage doublon est cadré par représentation', async () => {
    const repA = await creerRep({ title: 'A' })
    const repB = await creerRep({ title: 'B' })
    await seedBooking(repA.id, { status: 'paid', email: 'famille@exemple.fr', partySize: 1 })
    const res = await creer(demande({ representationId: repB.id, email: 'famille@exemple.fr' }), ACTOR)
    expect('booking' in res).toBe(true)
  })
})

describe('chercherDoublonsDemande', () => {
  it('email identique (actif) → emailMatch (raison « email »), absent de « autres » malgré tel+nom identiques', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, {
      status: 'pending',
      email: 'jean@exemple.fr',
      phone: '0102030405',
      name: 'Jean Martin',
    })
    const r = await chercherDoublons(rep.id, champs({ email: 'JEAN@Exemple.fr', phone: '0102030405', lastName: 'martin' }))
    expect(r.emailMatch).not.toBeNull()
    expect(r.emailMatch?.raison).toBe('email')
    expect(r.emailMatch?.email).toBe('jean@exemple.fr')
    expect(r.autres).toHaveLength(0)
  })

  it('email inconnu → emailMatch null', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, { status: 'pending', email: 'jean@exemple.fr' })
    const r = await chercherDoublons(rep.id, champs({ email: 'pas-jean@exemple.fr' }))
    expect(r.emailMatch).toBeNull()
  })

  it('téléphone identique, email différent → avertissement « telephone » (chiffres normalisés)', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, {
      status: 'pending',
      email: 'a@exemple.fr',
      phone: '0612345678',
      name: 'Alice Durand',
    })
    const r = await chercherDoublons(rep.id, champs({ email: 'b@exemple.fr', phone: '06 12 34 56 78' }))
    expect(r.emailMatch).toBeNull()
    expect(r.autres).toHaveLength(1)
    expect(r.autres[0].raison).toBe('telephone')
  })

  it('nom de famille contenu, email + tel différents → avertissement « nom »', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, {
      status: 'pending',
      email: 'a@exemple.fr',
      phone: '0700000000',
      name: 'Marie Dupont',
    })
    const r = await chercherDoublons(rep.id, champs({ email: 'b@exemple.fr', phone: '0611111111', lastName: 'dupont' }))
    expect(r.emailMatch).toBeNull()
    expect(r.autres).toHaveLength(1)
    expect(r.autres[0].raison).toBe('nom')
  })

  it('priorité téléphone > nom : un même enregistrement n’apparaît qu’une fois', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, {
      status: 'pending',
      email: 'a@exemple.fr',
      phone: '0612345678',
      name: 'Paul Dupont',
    })
    const r = await chercherDoublons(rep.id, champs({ email: 'b@exemple.fr', phone: '0612345678', lastName: 'dupont' }))
    expect(r.autres).toHaveLength(1)
    expect(r.autres[0].raison).toBe('telephone')
  })

  it('ignore les demandes inactives (cancelled / pending expiré)', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, { status: 'cancelled', email: 'jean@exemple.fr', phone: '0612345678', name: 'Jean Cancel' })
    await seedBooking(rep.id, {
      status: 'pending',
      email: 'paul@exemple.fr',
      phone: '0612345678',
      name: 'Paul Expir',
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    })
    const r = await chercherDoublons(rep.id, champs({ email: 'jean@exemple.fr', phone: '0612345678', lastName: 'expir' }))
    expect(r.emailMatch).toBeNull() // cancelled ignoré
    expect(r.autres).toHaveLength(0) // pending expiré ignoré
  })

  it('cadre par représentation', async () => {
    const repA = await creerRep({ title: 'A' })
    const repB = await creerRep({ title: 'B' })
    await seedBooking(repA.id, { status: 'paid', email: 'jean@exemple.fr', phone: '0612345678', name: 'Jean Martin' })
    const r = await chercherDoublons(repB.id, champs({ email: 'jean@exemple.fr', phone: '0612345678', lastName: 'martin' }))
    expect(r.emailMatch).toBeNull()
    expect(r.autres).toHaveLength(0)
  })

  it('champs phone / lastName vides → aucun avertissement bidon', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, { status: 'pending', email: 'jean@exemple.fr', phone: '0612345678', name: 'Jean Martin' })
    const r = await chercherDoublons(rep.id, champs({ email: 'autre@exemple.fr', phone: '', lastName: '' }))
    expect(r.emailMatch).toBeNull()
    expect(r.autres).toHaveLength(0)
  })

  it('cumule plusieurs avertissements (enregistrements distincts)', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, { status: 'pending', email: 'a@exemple.fr', phone: '0612345678', name: 'Alice Bernard' })
    await seedBooking(rep.id, { status: 'paid', email: 'b@exemple.fr', phone: '0799999999', name: 'Bob Martin' })
    const r = await chercherDoublons(rep.id, champs({ email: 'c@exemple.fr', phone: '0612345678', lastName: 'martin' }))
    expect(r.autres).toHaveLength(2)
    expect(r.autres.map((x) => x.raison).sort()).toEqual(['nom', 'telephone'])
  })

  it('« placed » compte comme actif ; expose token / nom / email / phone / status', async () => {
    const rep = await creerRep()
    await seedBooking(rep.id, {
      status: 'placed',
      email: 'jean@exemple.fr',
      phone: '0612345678',
      name: 'Jean Martin',
      publicToken: 'tok-jean',
    })
    const r = await chercherDoublons(rep.id, champs({ email: 'jean@exemple.fr' }))
    expect(r.emailMatch).toMatchObject({
      raison: 'email',
      email: 'jean@exemple.fr',
      name: 'Jean Martin',
      phone: '0612345678',
      status: 'placed',
      publicToken: 'tok-jean',
    })
  })
})
