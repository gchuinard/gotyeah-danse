// Chargement de la salle (lib/venue/load.ts).
//  - loadVenueConfig() : HORS base — salle intégrée (Bergerac) si pas de
//    VENUE_ID, sinon fichier config/venues/<id>.json (validé zod).
//  - loadActiveVenueConfig(db) : priorité base active > fichier VENUE_ID >
//    intégrée, sur une DB SQLite ISOLÉE ET JETABLE dans /tmp.
// On NE touche JAMAIS prisma/dev.db. Le fichier de salle de test est unique
// (pid) et nettoyé après chaque cas, comme la DB en fin de suite.

import { execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { venueConfig, type VenueConfig } from '@/config/venue'
import { loadActiveVenueConfig, loadVenueConfig } from '@/lib/venue/load'

const dbFile = `/tmp/billetterie-test-load-${process.pid}.db`
const url = `file:${dbFile}`
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// loadVenueConfig lit config/venues/<id>.json SOUS process.cwd() : on écrit
// exactement là, avec un id unique (pid) → zéro collision entre agents.
const venueId = `test-load-${process.pid}`
const venuesDir = path.join(process.cwd(), 'config', 'venues')
const fichierPath = path.join(venuesDir, `${venueId}.json`)
const VENUE_ID_INIT = process.env.VENUE_ID

let db: PrismaClient

// Mini-salles valides (même esprit que tests/venue/sync.ts) : 1 rang central.
const SALLE_FICHIER: VenueConfig = {
  name: 'Salle Fichier Test',
  center: { x: 10, y: 900 },
  numberingScheme: 'continu',
  rows: [{ label: 'Z', radius: 400, arcs: [{ section: 'centre', angleStart: -8, angleEnd: 8, seats: 5 }] }],
}

const SALLE_ACTIVE: VenueConfig = {
  name: 'Salle Active Test',
  center: { x: 0, y: 1000 },
  numberingScheme: 'pair-impair',
  rows: [{ label: 'A', radius: 500, arcs: [{ section: 'centre', angleStart: -10, angleEnd: 10, seats: 6 }] }],
}

function ecrireSalleFichier(contenu: string) {
  writeFileSync(fichierPath, contenu, 'utf8')
}

beforeAll(() => {
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = new PrismaClient({ datasources: { db: { url } } })
  mkdirSync(venuesDir, { recursive: true }) // idempotent : le dossier existe déjà
}, 60_000)

afterEach(async () => {
  // Isolation entre cas : DB sans salle, fichier de test retiré, env restauré.
  await db.venue.deleteMany()
  rmSync(fichierPath, { force: true })
  if (VENUE_ID_INIT === undefined) delete process.env.VENUE_ID
  else process.env.VENUE_ID = VENUE_ID_INIT
})

afterAll(async () => {
  await db.$disconnect()
  rmSync(fichierPath, { force: true })
  for (const suffix of ['', '-journal']) rmSync(dbFile + suffix, { force: true })
})

describe('loadVenueConfig (intégrée / fichier, sans DB)', () => {
  it('sans VENUE_ID → la salle intégrée (Bergerac), même objet', () => {
    delete process.env.VENUE_ID
    expect(loadVenueConfig()).toBe(venueConfig)
  })

  it('VENUE_ID aux caractères interdits → lève « invalide » (avant tout fichier)', () => {
    process.env.VENUE_ID = '../secret'
    expect(() => loadVenueConfig()).toThrow(/invalide/i)
  })

  it('VENUE_ID trop long (> 64 caractères) → lève « invalide » (limite du regex)', () => {
    process.env.VENUE_ID = 'a'.repeat(65)
    expect(() => loadVenueConfig()).toThrow(/invalide/i)
  })

  it('VENUE_ID valide mais fichier absent → lève « introuvable »', () => {
    process.env.VENUE_ID = `salle-absente-${process.pid}`
    expect(() => loadVenueConfig()).toThrow(/introuvable/i)
  })

  it('VENUE_ID valide + fichier présent → la config du fichier', () => {
    ecrireSalleFichier(JSON.stringify(SALLE_FICHIER))
    process.env.VENUE_ID = venueId
    const c = loadVenueConfig()
    expect(c.name).toBe('Salle Fichier Test')
    expect(c.rows).toHaveLength(1)
    expect(c.numberingScheme).toBe('continu')
  })

  it('fichier JSON valide mais config hors-schéma → lève « invalide »', () => {
    ecrireSalleFichier('{}') // ni center, ni rows, ni numberingScheme
    process.env.VENUE_ID = venueId
    expect(() => loadVenueConfig()).toThrow(/invalide/i)
  })

  it('fichier au JSON malformé → lève (JSON.parse, hors message ami)', () => {
    ecrireSalleFichier('{ ceci n est pas du json')
    process.env.VENUE_ID = venueId
    expect(() => loadVenueConfig()).toThrow()
  })
})

describe('loadActiveVenueConfig (priorité base > fichier > intégrée)', () => {
  it('une salle active en base PRIME (court-circuite un VENUE_ID bidon)', async () => {
    await db.venue.create({
      data: { name: 'Salle Active Test', config: JSON.stringify(SALLE_ACTIVE), isActive: true },
    })
    // VENUE_ID pointe sur une salle inexistante : si la base ne primait pas, le
    // repli fichier lèverait « introuvable ». Pas d'erreur ⇒ la base a primé.
    process.env.VENUE_ID = `salle-absente-${process.pid}`
    const r = await loadActiveVenueConfig(db)
    expect(r.source).toBe('base')
    expect(r.config.name).toBe('Salle Active Test')
    expect(r.config.rows).toHaveLength(1)
  })

  it('sans salle active ni VENUE_ID → la salle intégrée (source « integree »)', async () => {
    delete process.env.VENUE_ID
    const r = await loadActiveVenueConfig(db)
    expect(r.source).toBe('integree')
    expect(r.config).toBe(venueConfig)
  })

  it('sans salle active, avec VENUE_ID fichier → la config du fichier (source « fichier »)', async () => {
    ecrireSalleFichier(JSON.stringify(SALLE_FICHIER))
    process.env.VENUE_ID = venueId
    const r = await loadActiveVenueConfig(db)
    expect(r.source).toBe('fichier')
    expect(r.config.name).toBe('Salle Fichier Test')
  })

  it('une salle INACTIVE seule est ignorée → repli intégrée (filtre isActive)', async () => {
    await db.venue.create({
      data: { name: 'Salle Inactive', config: JSON.stringify(SALLE_ACTIVE), isActive: false },
    })
    delete process.env.VENUE_ID
    const r = await loadActiveVenueConfig(db)
    expect(r.source).toBe('integree')
    expect(r.config).toBe(venueConfig)
  })

  it('plusieurs salles, une seule active → la salle active est choisie', async () => {
    await db.venue.create({
      data: { name: 'Salle Inactive', config: JSON.stringify(SALLE_FICHIER), isActive: false },
    })
    await db.venue.create({
      data: { name: 'Salle Active Test', config: JSON.stringify(SALLE_ACTIVE), isActive: true },
    })
    const r = await loadActiveVenueConfig(db)
    expect(r.source).toBe('base')
    expect(r.config.name).toBe('Salle Active Test')
  })

  it('salle active au config JSON hors-schéma → rejette « invalide »', async () => {
    await db.venue.create({ data: { name: 'Salle Cassée', config: '{}', isActive: true } })
    await expect(loadActiveVenueConfig(db)).rejects.toThrow(/invalide/i)
  })
})
