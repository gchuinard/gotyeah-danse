// GET /admin/tests — sert le rapport HTML Playwright (test-report/index.html,
// un seul fichier auto-contenu) DERRIÈRE le login admin. Le proxy garde déjà
// /admin/* (session) ; on re-vérifie ici (défense en profondeur).
//
// SNAPSHOT : reflète le dernier run COMMITTÉ. Le site en prod ne lance pas les
// tests — flux : `pnpm e2e` en local régénère test-report/index.html → commit
// → déploie → cette page se met à jour.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { getAdminSession } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await getAdminSession())) {
    return new Response('Non autorisé', { status: 401 })
  }
  try {
    const html = await readFile(path.join(process.cwd(), 'test-report', 'index.html'))
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch {
    return new Response(
      'Rapport de tests indisponible — lance `pnpm e2e` en local puis redéploie.',
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }
}
