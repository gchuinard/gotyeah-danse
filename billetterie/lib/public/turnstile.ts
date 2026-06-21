// Vérification Cloudflare Turnstile (CAPTCHA invisible) côté serveur.
// Même philosophie que Brevo : SANS clé secrète configurée, on ne bloque rien
// (bypass dev/local). La protection ne s'active qu'en présence de
// TURNSTILE_SECRET_KEY (prod). La clé publique (site key) est passée au
// composant client par le server component.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function turnstileSiteKey(): string | undefined {
  return process.env.TURNSTILE_SITE_KEY || undefined
}

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

// true = humain présumé (ou Turnstile désactivé). false = échec du challenge.
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true // non configuré → on n'exige rien (dev)
  if (!token) return false

  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip && ip !== 'inconnue') body.set('remoteip', ip)

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      // Ne pas mettre en cache une vérification anti-bot.
      cache: 'no-store',
    })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch (e) {
    // Réseau HS côté serveur : on refuse plutôt que d'ouvrir une faille
    // (fail-closed assumé). On loggue pour repérer une panne Cloudflare.
    console.error('[turnstile] vérification injoignable, demande refusée:', e)
    return false
  }
}
