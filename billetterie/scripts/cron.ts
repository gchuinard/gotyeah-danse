// Tâches planifiées de la billetterie : expiration des demandes échues
// PUIS relance J+7 des demandes toujours en attente de règlement.
//
// Lancer depuis billetterie/ :
//   pnpm cron          → daemon node-cron, tous les jours à 9h00 (Europe/Paris)
//   pnpm cron --once   → exécute les deux jobs immédiatement puis sort
//                        (test manuel, ou conteneur qui planifie lui-même)
//
// Les jobs sont idempotents (statut 'expired', remindedAt) : relancer --once
// deux fois de suite n'expire rien deux fois et ne renvoie aucun e-mail.

import cron from 'node-cron'

import { expirerDemandes, relancerDemandes } from '../lib/admin/cron'
import { prisma } from '../lib/db'
import { sendReminderEmail } from '../lib/email/booking'

// Exécute les deux jobs dans l'ordre. Chaque job est catché individuellement :
// un job qui plante ne tue ni l'autre job ni le daemon. Retourne false si
// au moins un job a planté (→ exit 1 en mode --once).
async function executerJobs(): Promise<boolean> {
  let ok = true

  try {
    const expirees = await expirerDemandes(prisma)
    console.log(`[cron] expiration : ${expirees} demande(s) expirée(s)`)
  } catch (err) {
    ok = false
    console.error('[cron] expiration : échec —', err instanceof Error ? err.message : err)
  }

  try {
    const { envoyees, echecs } = await relancerDemandes(prisma, sendReminderEmail)
    console.log(`[cron] relance J+7 : ${envoyees} envoyée(s), ${echecs} échec(s)`)
  } catch (err) {
    ok = false
    console.error('[cron] relance J+7 : échec —', err instanceof Error ? err.message : err)
  }

  return ok
}

async function main(): Promise<void> {
  if (process.argv.includes('--once')) {
    const ok = await executerJobs()
    await prisma.$disconnect()
    process.exit(ok ? 0 : 1)
  }

  // Daemon : un passage quotidien à 9h00, heure de Paris.
  const task = cron.schedule('0 9 * * *', () => void executerJobs(), {
    timezone: 'Europe/Paris',
  })
  console.log('[cron] démarré — passage quotidien à 9h00 (Europe/Paris), Ctrl-C pour arrêter')

  // Arrêt propre : on coupe la planification puis la connexion DB.
  const arreter = async (signal: string) => {
    console.log(`[cron] ${signal} reçu, arrêt`)
    await task.destroy()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGINT', () => void arreter('SIGINT'))
  process.on('SIGTERM', () => void arreter('SIGTERM'))
}

void main()
