// Création (ou réinitialisation du mot de passe) d'un compte admin.
//
//   pnpm admin:create admin@exemple.fr 'mot-de-passe'
//
// Tous les comptes sont équivalents (pas de rôles). Si l'email existe déjà,
// le mot de passe est simplement remplacé — c'est aussi l'outil de reset.
// NB : le mot de passe passe par argv, donc par l'historique du shell ;
// préfixer la commande d'un espace (HISTCONTROL=ignorespace) si ça gêne.

import bcrypt from 'bcryptjs'
import { prisma } from '../lib/db'

async function main() {
  const [email, password] = process.argv.slice(2)
  if (!email || !password) {
    console.error("Usage : pnpm admin:create <email> '<mot de passe>'")
    process.exit(1)
  }
  const cleanEmail = email.toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    console.error('Email invalide.')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('Mot de passe trop court (8 caractères minimum).')
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const existing = await prisma.adminUser.findUnique({ where: { email: cleanEmail } })
  await prisma.adminUser.upsert({
    where: { email: cleanEmail },
    update: { passwordHash },
    create: { email: cleanEmail, passwordHash },
  })
  console.log(
    existing
      ? `Mot de passe réinitialisé pour ${cleanEmail}.`
      : `Compte admin créé : ${cleanEmail}.`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
