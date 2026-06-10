// Liste blanche des admins — ADMIN_EMAILS dans le .env, séparés par des
// virgules. C'est LA source de vérité : pas de table de comptes, pas de
// mot de passe. Ajouter/retirer un bénévole = éditer le .env et redémarrer.

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase())
}
