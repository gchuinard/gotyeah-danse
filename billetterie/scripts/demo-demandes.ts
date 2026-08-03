// Génère des « demandes à placer » de démo en base (statut paid, sans
// billets) pour voir le rendu de l'écran de placement / de la file des
// demandes. HORS PRODUCTION.
//
//   pnpm tsx scripts/demo-demandes.ts            # crée 25 demandes
//   pnpm tsx scripts/demo-demandes.ts --count=40 # crée 40 demandes
//   pnpm tsx scripts/demo-demandes.ts --clear     # supprime les demandes de démo
//
// Idempotent : les demandes ont un publicToken déterministe « demo-demande-NN »
// (upsert) ; relancer ne crée pas de doublons. --clear les enlève toutes.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const TOKEN_PREFIX = 'demo-demande-'
const DAY_MS = 24 * 60 * 60 * 1000

// Noms variés + tailles de groupe réalistes (2→6). Quelques demandes PMR pour
// voir le badge et la suggestion adaptée.
const PRENOMS = [
  'Camille', 'Julien', 'Élodie', 'Thomas', 'Sophie', 'Lucas', 'Marie', 'Hugo',
  'Léa', 'Nathan', 'Chloé', 'Antoine', 'Manon', 'Maxime', 'Sarah', 'Paul',
  'Inès', 'Clément', 'Jade', 'Romain', 'Louise', 'Théo', 'Emma', 'Alexandre', 'Nina',
]
const NOMS = [
  'Bertrand', 'Moreau', 'Garnier', 'Lefèvre', 'Renaud', 'Petit', 'Durand', 'Lambert',
  'Fontaine', 'Rousseau', 'Vincent', 'Mercier', 'Blanc', 'Guérin', 'Muller', 'Henry',
  'Roussel', 'Nicolas', 'Perrin', 'Morel', 'Girard', 'André', 'Lemaire', 'Faure', 'Gauthier',
]
// Tailles : surtout 2-4, quelques grands groupes.
const TAILLES = [2, 4, 3, 5, 2, 3, 6, 2, 4, 3, 2, 5, 3, 4, 2, 6, 3, 2, 4, 3, 5, 2, 4, 3, 2]
const NOTES_PMR: Record<number, string> = {
  3: 'Une personne en fauteuil roulant (PMR)',
  12: 'Place PMR souhaitée + accompagnant',
  20: 'Mobilité réduite, éviter les marches',
}

function parseCount(argv: string[]): number {
  const m = argv.map((a) => /^--count=(\d+)$/.exec(a)).find(Boolean)
  return m ? Math.max(1, Math.min(200, Number(m[1]))) : 25
}

async function clear() {
  const { count } = await prisma.booking.deleteMany({
    where: { publicToken: { startsWith: TOKEN_PREFIX } },
  })
  console.log(`Supprimé ${count} demande(s) de démo.`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--clear')) {
    await clear()
    return
  }

  const count = parseCount(argv)

  // Jamais sur une représentation archivée : ses demandes seraient créées
  // directement gelées (et invisibles dans /admin/demandes).
  const reps = await prisma.representation.findMany({
    where: { archivedAt: null },
    orderBy: { startsAt: 'asc' },
  })
  if (reps.length === 0) {
    throw new Error(
      'Aucune représentation active en base — lance d’abord le seed (pnpm db:seed), ou désarchive une représentation.',
    )
  }

  const base = new Date('2026-06-08T09:00:00+02:00').getTime()
  let created = 0
  for (let i = 0; i < count; i++) {
    const prenom = PRENOMS[i % PRENOMS.length]
    const nom = NOMS[(i * 7) % NOMS.length]
    const partySize = TAILLES[i % TAILLES.length]
    const rep = reps[i % reps.length] // réparties sur toutes les représentations
    const createdAt = new Date(base + i * 37 * 60 * 1000) // ~37 min d'écart
    const numero = String(i + 1).padStart(2, '0')

    const data = {
      representationId: rep.id,
      name: `${prenom} ${nom}`,
      email: `${prenom}.${nom}@example.com`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
      phone: `06${String(10000000 + i * 137911).slice(0, 8)}`,
      partySize,
      notes: NOTES_PMR[i + 1] ?? null,
      status: 'paid',
      createdAt,
      paidAt: new Date(createdAt.getTime() + 2 * 60 * 60 * 1000),
      placedAt: null,
      expiresAt: new Date(createdAt.getTime() + 14 * DAY_MS),
      remindedAt: null,
    }
    await prisma.booking.upsert({
      where: { publicToken: `${TOKEN_PREFIX}${numero}` },
      update: data,
      create: { publicToken: `${TOKEN_PREFIX}${numero}`, ...data },
    })
    created++
  }

  const repartition = reps
    .map((r) => `${r.title} : ${Math.ceil((count - reps.indexOf(r)) / reps.length)}`)
    .join(' · ')
  console.log(`${created} demande(s) « à placer » (statut paid) créées.`)
  console.log(`Réparties sur : ${repartition}`)
  console.log('Vois-les dans /admin/demandes, puis ouvre « Placer » sur l’une d’elles.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
