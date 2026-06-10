// Transport e-mail générique — Brevo si la clé est présente, log console sinon.
//
// Règle absolue : ne jette jamais. Un e-mail qui échoue ne doit jamais
// faire échouer la réservation qui l'a déclenché.

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'

export async function sendEmail(opts: {
  to: string
  toName?: string
  subject: string
  html: string
}): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY

  // Mode dev : pas de clé → on logue (adresse + sujet uniquement, jamais le corps).
  if (!apiKey) {
    console.log(`[email dev] → ${opts.to} — ${opts.subject}`)
    return true
  }

  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: process.env.EMAIL_SENDER_NAME ?? 'École de danse Desha-Moulin',
          email: process.env.EMAIL_SENDER_ADDRESS ?? 'billetterie@cours-danse-bergerac.fr',
        },
        to: [{ email: opts.to, ...(opts.toName ? { name: opts.toName } : {}) }],
        subject: opts.subject,
        htmlContent: opts.html,
      }),
    })

    if (!res.ok) {
      console.error(`[email] échec Brevo (HTTP ${res.status}) → ${opts.to}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[email] échec réseau → ${opts.to}`, err instanceof Error ? err.message : err)
    return false
  }
}
