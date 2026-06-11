// Seed de la billetterie — REPRODUCTIBLE et RELANÇABLE (upsert partout,
// ids déterministes issus de lib/venue/generate.ts).
//
// ⚠️ Le champ Seat.score est ré-écrit à CHAQUE seed (update complet).
//    Une fois que l'admin a ajusté les scores à la main, ne plus relancer
//    le seed — la calibration (config/venue.ts + re-seed) se fait AVANT.
//
// Après les upserts, les sièges/rangées absents du plan généré sont
// supprimés (deleteMany notIn) pour que la calibration ne laisse pas
// d'orphelins. Si un siège supprimé porte des tickets, l'erreur FK
// remonte volontairement : la calibration a lieu avant les ventes.

import { PrismaClient } from '@prisma/client'
import { venueConfig } from '../config/venue'
import { generateSeats, SECTION_ORDER } from '../lib/venue/generate'

const prisma = new PrismaClient()

// Date locale Europe/Paris : en juin, la France est en heure d'été (UTC+2).
const parisSummer = (iso: string) => new Date(`${iso}:00+02:00`)

const DAY_MS = 24 * 60 * 60 * 1000

async function seedPlan() {
  const seats = generateSeats(venueConfig)

  // Sections — id = nom, ordre fixe gauche/centre/droite.
  const sections = (Object.entries(SECTION_ORDER) as [string, number][]).map(([id, order]) => ({
    id,
    name: id,
    order,
  }))
  await prisma.$transaction(
    sections.map((s) =>
      prisma.section.upsert({
        where: { id: s.id },
        update: { name: s.name, order: s.order },
        create: s,
      }),
    ),
  )

  // Rangées — une par couple (section, label), dédupliquées depuis les sièges.
  const rows = new Map<string, { id: string; sectionId: string; label: string; order: number }>()
  for (const s of seats) {
    rows.set(s.rowId, { id: s.rowId, sectionId: s.section, label: s.rowLabel, order: s.rowOrder })
  }
  await prisma.$transaction(
    [...rows.values()].map((r) =>
      prisma.row.upsert({
        where: { id: r.id },
        update: { sectionId: r.sectionId, label: r.label, order: r.order },
        create: r,
      }),
    ),
  )

  // Sièges — upserts groupés par rangée (paquets de transaction → perf SQLite).
  const byRow = new Map<string, typeof seats>()
  for (const s of seats) {
    const list = byRow.get(s.rowId) ?? []
    list.push(s)
    byRow.set(s.rowId, list)
  }
  for (const rowSeats of byRow.values()) {
    await prisma.$transaction(
      rowSeats.map((s) => {
        const data = {
          rowId: s.rowId,
          number: s.number,
          indexInRow: s.indexInRow,
          x: s.x,
          y: s.y,
          angle: s.angle,
          removable: s.removable,
          score: s.score,
        }
        return prisma.seat.upsert({
          where: { id: s.id },
          update: data, // TOUS les champs, score compris (cf. avertissement en tête)
          create: { id: s.id, ...data },
        })
      }),
    )
  }

  // Nettoyage des orphelins de calibration (sièges d'abord, FK oblige).
  const deletedSeats = await prisma.seat.deleteMany({
    where: { id: { notIn: seats.map((s) => s.id) } },
  })
  const deletedRows = await prisma.row.deleteMany({
    where: { id: { notIn: [...rows.keys()] } },
  })
  if (deletedSeats.count || deletedRows.count) {
    console.log(`Calibration : ${deletedSeats.count} siège(s) et ${deletedRows.count} rangée(s) orphelins supprimés`)
  }

  return { sections: sections.length, rows: rows.size, seats: seats.length }
}

async function seedRepresentations() {
  const reps = [
    { id: 'rep-samedi', title: 'Samedi 20h30', startsAt: parisSummer('2026-06-20T20:30') },
    { id: 'rep-dimanche', title: 'Dimanche 15h00', startsAt: parisSummer('2026-06-21T15:00') },
  ]
  for (const r of reps) {
    await prisma.representation.upsert({
      where: { id: r.id },
      update: { title: r.title, startsAt: r.startsAt, isOpen: true },
      create: { ...r, isOpen: true },
    })
  }
  return reps.length
}

// NB : plus de comptes admin en base — les admins sont la liste blanche
// ADMIN_EMAILS du .env (login par code envoyé par email).

// Booking de démo « placé » : ses billets occupent 4 sièges contigus du
// rang R central (rang central, bon score). qrToken = UUID fixes écrits en
// dur (clé d'upsert).
const PLACED_DEMO = {
  publicToken: 'f6a8c0e2-4b6d-4f8a-9c1e-3d5f7a9b1c3e',
  representationId: 'rep-samedi',
  tickets: [
    { qrToken: '9b1d3f5a-7c9e-4b2d-8f4a-6c8e0a2c4e6f', seatId: 'centre-R-04' },
    { qrToken: '4d6f8a0c-2e4b-4d7f-9a1c-3e5a7c9e1f3b', seatId: 'centre-R-05' },
    { qrToken: 'e2b4d6f8-0a2c-4e6b-8d0f-2a4c6e8b0d2f', seatId: 'centre-R-06' },
    { qrToken: '7a9c1e3b-5d7f-4a8c-9e2b-4f6a8c0e2a4c', seatId: 'centre-R-07' },
  ],
}

// Bookings de démo — hors production uniquement. publicToken = UUID fixes
// écrits en dur : c'est la clé d'upsert qui rend le seed relançable.
async function seedDemoBookings() {
  const bookings = [
    {
      publicToken: '5f1e7c1a-9b3d-4e6f-8a2c-0d4b6e8f1a3c',
      representationId: 'rep-samedi',
      name: 'Camille Bertrand',
      email: 'camille.bertrand@example.com',
      phone: '0612345678',
      partySize: 4,
      status: 'pending',
      notes: null as string | null,
      createdAt: parisSummer('2026-06-01T10:15'),
    },
    {
      publicToken: 'a2c4e6f8-1b3d-4f5a-9c7e-2d4f6a8b0c1e',
      representationId: 'rep-samedi',
      name: 'Julien Moreau',
      email: 'julien.moreau@example.com',
      phone: '0623456789',
      partySize: 2,
      status: 'paid',
      notes: null,
      createdAt: parisSummer('2026-06-02T14:30'),
    },
    {
      publicToken: '3d5f7a9b-2c4e-4a6b-8d0f-1e3a5c7b9d2f',
      representationId: 'rep-samedi',
      name: 'Élodie Garnier',
      email: 'elodie.garnier@example.com',
      phone: '0634567890',
      partySize: 6,
      status: 'paid',
      notes: 'Une personne en fauteuil roulant (PMR)',
      createdAt: parisSummer('2026-06-03T09:05'),
    },
    {
      publicToken: '8b0d2f4a-6c8e-4b1d-9f3a-5c7e9b1d3f5a',
      representationId: 'rep-dimanche',
      name: 'Thomas Lefèvre',
      email: 'thomas.lefevre@example.com',
      phone: '0645678901',
      partySize: 3,
      status: 'pending',
      notes: null,
      createdAt: parisSummer('2026-06-04T18:45'),
    },
    {
      publicToken: 'c1e3a5b7-9d2f-4c6a-8b0e-3f5a7c9e1b4d',
      representationId: 'rep-dimanche',
      name: 'Sophie Renaud',
      email: 'sophie.renaud@example.com',
      phone: '0656789012',
      partySize: 5,
      status: 'paid',
      notes: null,
      createdAt: parisSummer('2026-06-05T11:20'),
    },
    {
      publicToken: PLACED_DEMO.publicToken,
      representationId: PLACED_DEMO.representationId,
      name: 'Famille Dupuis',
      email: 'marion.dupuis@example.com',
      phone: '0667890123',
      partySize: PLACED_DEMO.tickets.length,
      status: 'placed',
      notes: null,
      createdAt: parisSummer('2026-06-06T16:40'),
    },
  ]

  for (const b of bookings) {
    const expiresAt = new Date(b.createdAt.getTime() + 14 * DAY_MS)
    const isPaid = b.status === 'paid' || b.status === 'placed'
    const data = {
      representationId: b.representationId,
      name: b.name,
      email: b.email,
      phone: b.phone,
      partySize: b.partySize,
      notes: b.notes,
      status: b.status,
      createdAt: b.createdAt,
      paidAt: isPaid ? new Date(b.createdAt.getTime() + 2 * 60 * 60 * 1000) : null,
      placedAt: b.status === 'placed' ? new Date(b.createdAt.getTime() + 3 * DAY_MS) : null,
      expiresAt,
      remindedAt: null, // ré-armé à chaque seed : le cron de relance reste testable
    }
    await prisma.booking.upsert({
      where: { publicToken: b.publicToken },
      update: data,
      create: { publicToken: b.publicToken, ...data },
    })
  }

  const ticketCount = await seedDemoTickets()
  return { bookings: bookings.length, tickets: ticketCount }
}

// Billets du booking « placé » — upsert par qrToken. La contrainte
// @@unique([representationId, seatId]) est respectée : les sièges visés
// ne sont occupés par aucun autre booking de démo.
async function seedDemoTickets() {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { publicToken: PLACED_DEMO.publicToken },
  })

  // Garde-fou calibration : les sièges visés doivent exister dans le plan.
  const seatIds = PLACED_DEMO.tickets.map((t) => t.seatId)
  const found = await prisma.seat.count({ where: { id: { in: seatIds } } })
  if (found !== seatIds.length) {
    throw new Error(`Seed : sièges de démo introuvables dans le plan (${seatIds.join(', ')})`)
  }

  for (const t of PLACED_DEMO.tickets) {
    const data = {
      bookingId: booking.id,
      representationId: PLACED_DEMO.representationId,
      seatId: t.seatId,
    }
    await prisma.ticket.upsert({
      where: { qrToken: t.qrToken },
      update: data,
      create: { qrToken: t.qrToken, ...data },
    })
  }
  return PLACED_DEMO.tickets.length
}

async function main() {
  const plan = await seedPlan()
  const repCount = await seedRepresentations()
  const demo =
    process.env.NODE_ENV !== 'production' ? await seedDemoBookings() : { bookings: 0, tickets: 0 }

  console.log('Seed terminé :')
  console.log(`  sections        : ${plan.sections}`)
  console.log(`  rangées         : ${plan.rows}`)
  console.log(`  sièges          : ${plan.seats}`)
  console.log(`  représentations : ${repCount}`)
  console.log(`  bookings démo   : ${demo.bookings}`)
  console.log(`  billets démo    : ${demo.tickets}`)
  console.log('Admins : liste blanche ADMIN_EMAILS du .env (login par code email).')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
