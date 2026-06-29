// Accès « j'ai déjà une demande » : email + identifiant de demande (codeDemande
// dérivé du publicToken). Sur une DB SQLite ISOLÉE ET JETABLE dans /tmp.
//
// ⚠️ Ce module tape le prisma GLOBAL (@/lib/db instancie new PrismaClient() à
// l'import, depuis DATABASE_URL). On le détourne vers la base jetable en réglant
// process.env.DATABASE_URL AVANT tout import du module, puis import DYNAMIQUE
// dans le beforeAll (une fois la base poussée). On ne touche JAMAIS prisma/dev.db.

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { codeDemande } from '@/lib/booking/code'

const dbFile = `/tmp/billetterie-test-acces-${process.pid}.db`
const url = `file:${dbFile}`
// Détourne le prisma global vers la base jetable AVANT l'import dynamique du module.
process.env.DATABASE_URL = url

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let db: PrismaClient
// Import type-only (erasé) : pas d'import runtime ici, sinon le prisma global
// serait instancié trop tôt. Le vrai import a lieu dans le beforeAll.
let acces: typeof import('@/lib/booking/acces')

// Crée une demande minimale (champs requis du modèle Booking) sur rep-test.
async function seedBooking(o: {
  email: string
  status: string
  publicToken: string
  expiresAt?: Date | null
}) {
  return db.booking.create({
    data: {
      representationId: 'rep-test',
      name: 'Famille Test',
      email: o.email,
      phone: '0612345678',
      partySize: 2,
      status: o.status,
      publicToken: o.publicToken,
      expiresAt: o.expiresAt ?? null,
    },
  })
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = new PrismaClient({ datasources: { db: { url } } })
  // Import DYNAMIQUE : le prisma global du module est instancié ICI, après que
  // DATABASE_URL pointe sur la base jetable.
  acces = await import('@/lib/booking/acces')

  await db.representation.create({
    data: { id: 'rep-test', title: 'Samedi 20h30', startsAt: new Date('2026-06-27T18:30:00Z') },
  })

  // marie a DEUX demandes actives (pending sans expiration + paid) → teste la
  // désambiguïsation par code et la pending renvoyée par email.
  await seedBooking({ email: 'marie@exemple.fr', status: 'pending', publicToken: 'tok-pending' })
  await seedBooking({ email: 'marie@exemple.fr', status: 'paid', publicToken: 'tok-paid' })
  // paul : une demande placée (active, mais pas « en attente »).
  await seedBooking({ email: 'paul@exemple.fr', status: 'placed', publicToken: 'tok-placed' })
  // Statuts exclus du lookup par code.
  await seedBooking({ email: 'anna@exemple.fr', status: 'cancelled', publicToken: 'tok-cancelled' })
  await seedBooking({ email: 'bob@exemple.fr', status: 'expired', publicToken: 'tok-expired' })
  // pending avec expiration future / passée → teste la fenêtre de validité.
  await seedBooking({
    email: 'claire@exemple.fr',
    status: 'pending',
    publicToken: 'tok-future',
    expiresAt: new Date('2026-07-01T00:00:00Z'),
  })
  await seedBooking({
    email: 'denis@exemple.fr',
    status: 'pending',
    publicToken: 'tok-past',
    expiresAt: new Date('2000-01-01T00:00:00Z'),
  })
}, 60_000)

afterAll(async () => {
  await db.$disconnect()
  // SQLite peut laisser des fichiers annexes (journal/wal/shm).
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(dbFile + suffix, { force: true })
})

describe('trouverDemandeParCode', () => {
  it('email + bon code → trouvee (publicToken renvoyé)', async () => {
    const r = await acces.trouverDemandeParCode('marie@exemple.fr', codeDemande('tok-pending'))
    expect(r.type).toBe('trouvee')
    if (r.type === 'trouvee') expect(r.publicToken).toBe('tok-pending')
  })

  it('demande payée (paid) également trouvée', async () => {
    const r = await acces.trouverDemandeParCode('marie@exemple.fr', codeDemande('tok-paid'))
    expect(r).toEqual({ type: 'trouvee', publicToken: 'tok-paid' })
  })

  it('demande placée (placed) également trouvée', async () => {
    const r = await acces.trouverDemandeParCode('paul@exemple.fr', codeDemande('tok-placed'))
    expect(r).toEqual({ type: 'trouvee', publicToken: 'tok-placed' })
  })

  it('désambiguïse par le code quand l’email a plusieurs demandes', async () => {
    const a = await acces.trouverDemandeParCode('marie@exemple.fr', codeDemande('tok-pending'))
    const b = await acces.trouverDemandeParCode('marie@exemple.fr', codeDemande('tok-paid'))
    expect(a).toEqual({ type: 'trouvee', publicToken: 'tok-pending' })
    expect(b).toEqual({ type: 'trouvee', publicToken: 'tok-paid' })
  })

  it('tolère casse et espaces sur l’email et le code', async () => {
    const code = codeDemande('tok-pending')
    const sale = `${code.slice(0, 3)} ${code.slice(3)}`.toLowerCase()
    const r = await acces.trouverDemandeParCode('  Marie@Exemple.FR ', sale)
    expect(r).toEqual({ type: 'trouvee', publicToken: 'tok-pending' })
  })

  it('mauvais email + bon code → introuvable (cadrage par email)', async () => {
    const r = await acces.trouverDemandeParCode('inconnu@exemple.fr', codeDemande('tok-pending'))
    expect(r).toEqual({ type: 'introuvable' })
  })

  it('bon email mais code d’une demande d’autrui → introuvable', async () => {
    // tok-placed appartient à paul : marie ne doit pas y accéder.
    const r = await acces.trouverDemandeParCode('marie@exemple.fr', codeDemande('tok-placed'))
    expect(r).toEqual({ type: 'introuvable' })
  })

  it('faute de frappe sur le code → introuvable', async () => {
    const code = codeDemande('tok-pending')
    const faux = (code[0] === 'A' ? 'B' : 'A') + code.slice(1)
    const r = await acces.trouverDemandeParCode('marie@exemple.fr', faux)
    expect(r).toEqual({ type: 'introuvable' })
  })

  it('code trop long → introuvable (égalité stricte, pas de troncature)', async () => {
    const r = await acces.trouverDemandeParCode('marie@exemple.fr', codeDemande('tok-pending') + 'AB')
    expect(r).toEqual({ type: 'introuvable' })
  })

  it('code trop court → introuvable', async () => {
    const tronque = codeDemande('tok-pending').slice(0, 5)
    const r = await acces.trouverDemandeParCode('marie@exemple.fr', tronque)
    expect(r).toEqual({ type: 'introuvable' })
  })

  it('email vide → introuvable', async () => {
    const code = codeDemande('tok-pending')
    expect(await acces.trouverDemandeParCode('', code)).toEqual({ type: 'introuvable' })
    expect(await acces.trouverDemandeParCode('   ', code)).toEqual({ type: 'introuvable' })
  })

  it('code vide ou sans caractère alphanumérique → introuvable', async () => {
    expect(await acces.trouverDemandeParCode('marie@exemple.fr', '')).toEqual({ type: 'introuvable' })
    expect(await acces.trouverDemandeParCode('marie@exemple.fr', '   ')).toEqual({
      type: 'introuvable',
    })
    expect(await acces.trouverDemandeParCode('marie@exemple.fr', '-- ·/')).toEqual({
      type: 'introuvable',
    })
  })

  it('demande annulée (cancelled) → introuvable (statut exclu)', async () => {
    const r = await acces.trouverDemandeParCode('anna@exemple.fr', codeDemande('tok-cancelled'))
    expect(r).toEqual({ type: 'introuvable' })
  })

  it('demande expirée (expired) → introuvable (statut exclu)', async () => {
    const r = await acces.trouverDemandeParCode('bob@exemple.fr', codeDemande('tok-expired'))
    expect(r).toEqual({ type: 'introuvable' })
  })
})

describe('demandeEnAttentePourEmail', () => {
  it('email avec pending (sans expiration) → la demande + représentation incluse', async () => {
    const d = await acces.demandeEnAttentePourEmail('marie@exemple.fr')
    expect(d).not.toBeNull()
    expect(d?.publicToken).toBe('tok-pending')
    expect(d?.status).toBe('pending')
    expect(d?.representation.title).toBe('Samedi 20h30')
    expect(d?.representation.startsAt).toBeInstanceOf(Date)
  })

  it('pending non expirée (expiresAt futur vs now) → la demande', async () => {
    const d = await acces.demandeEnAttentePourEmail(
      'claire@exemple.fr',
      new Date('2026-06-15T00:00:00Z'),
    )
    expect(d?.publicToken).toBe('tok-future')
  })

  it('pending expirée (expiresAt passé) → null', async () => {
    expect(await acces.demandeEnAttentePourEmail('denis@exemple.fr')).toBeNull()
  })

  it('paramètre now : la même pending bascule selon la date fournie', async () => {
    const avant = await acces.demandeEnAttentePourEmail(
      'claire@exemple.fr',
      new Date('2026-06-15T00:00:00Z'),
    )
    const apres = await acces.demandeEnAttentePourEmail(
      'claire@exemple.fr',
      new Date('2026-08-15T00:00:00Z'),
    )
    expect(avant?.publicToken).toBe('tok-future')
    expect(apres).toBeNull()
  })

  it('email sans pending (demande placée seulement) → null', async () => {
    expect(await acces.demandeEnAttentePourEmail('paul@exemple.fr')).toBeNull()
  })

  it('email vide → null', async () => {
    expect(await acces.demandeEnAttentePourEmail('')).toBeNull()
    expect(await acces.demandeEnAttentePourEmail('   ')).toBeNull()
  })

  it('tolère casse et espaces sur l’email', async () => {
    const d = await acces.demandeEnAttentePourEmail('  Marie@Exemple.FR ')
    expect(d?.publicToken).toBe('tok-pending')
  })

  it('email inconnu → null', async () => {
    expect(await acces.demandeEnAttentePourEmail('personne@exemple.fr')).toBeNull()
  })
})
