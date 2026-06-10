// Codes de connexion à usage unique : 6 chiffres, 10 minutes, 5 essais.
// Seul le hash sha256 est stocké ; demander un nouveau code invalide les
// précédents. Logique pure DB (client injecté) : testable sur DB jetable.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

export const CODE_TTL_MS = 10 * 60 * 1000
export const MAX_ATTEMPTS = 5

const hash = (code: string) => createHash('sha256').update(code).digest('hex')

// Crée un code pour cet email (et invalide les anciens). Retourne le code en
// clair — à envoyer par email, jamais à stocker ni logger.
export async function createLoginCode(db: PrismaClient, email: string, now = new Date()): Promise<string> {
  const cleanEmail = email.trim().toLowerCase()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')

  await db.$transaction([
    // Un seul code actif par email + purge opportuniste des codes périmés.
    db.loginCode.deleteMany({
      where: { OR: [{ email: cleanEmail }, { expiresAt: { lt: now } }] },
    }),
    db.loginCode.create({
      data: {
        email: cleanEmail,
        codeHash: hash(code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      },
    }),
  ])
  return code
}

// Vérifie un code. Succès → le code est consommé (usage unique).
// Chaque échec incrémente attempts ; au-delà de MAX_ATTEMPTS le code est mort.
export async function verifyLoginCode(
  db: PrismaClient,
  email: string,
  code: string,
  now = new Date(),
): Promise<boolean> {
  const cleanEmail = email.trim().toLowerCase()
  const candidate = await db.loginCode.findFirst({
    where: { email: cleanEmail, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  })
  if (!candidate || candidate.attempts >= MAX_ATTEMPTS) return false

  const ok = timingSafeEqual(Buffer.from(hash(code)), Buffer.from(candidate.codeHash))
  if (!ok) {
    await db.loginCode.update({
      where: { id: candidate.id },
      data: { attempts: { increment: 1 } },
    })
    return false
  }

  // Consommation conditionnelle : si deux requêtes arrivent en même temps
  // avec le bon code, une seule gagne.
  const { count } = await db.loginCode.updateMany({
    where: { id: candidate.id, consumedAt: null },
    data: { consumedAt: now },
  })
  return count === 1
}
