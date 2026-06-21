// IP cliente pour le rate-limit. Derrière Cloudflare + Nginx Proxy Manager,
// `cf-connecting-ip` porte l'IP réelle et n'est PAS falsifiable par le client
// (CF la réécrit) ; `x-forwarded-for` est en secours (et son 1er élément est
// usurpable — d'où la reco NPM d'écraser XFF avec CF-Connecting-IP, cf.
// docs/revue-securite.md §5). On lit donc CF en priorité.

import { headers } from 'next/headers'

export async function clientIp(): Promise<string> {
  const h = await headers()
  const cf = h.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return fwd || 'inconnue'
}
