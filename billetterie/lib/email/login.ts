// Envoi du code de connexion admin. En dev (sans BREVO_API_KEY), sendEmail
// logge l'envoi en console — et le code est AUSSI loggé ici, sinon impossible
// de se connecter en local.

import { render } from 'react-email'
import LoginCodeEmail from '@/emails/login-code'
import { sendEmail } from './send'

export async function sendLoginCodeEmail(email: string, code: string): Promise<boolean> {
  if (!process.env.BREVO_API_KEY) {
    // Dev uniquement : jamais de code en clair dans les logs de prod.
    console.log(`[email dev] code de connexion pour ${email} : ${code}`)
  }
  const html = await render(LoginCodeEmail({ code }))
  return sendEmail({
    to: email,
    subject: 'Votre code de connexion — Billetterie',
    html,
  })
}
