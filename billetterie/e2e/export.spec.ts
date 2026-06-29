// E2E — Export CSV des demandes (admin). Couvre la route handler
// app/api/admin/export/[repId]/route.ts : GET → fichier CSV « Excel FR »
// (séparateur « ; », BOM UTF-8, échappement par guillemets doublés), pensé pour
// la feuille de caisse de la billetterie.
//
// On teste une ROUTE API, pas une page : on attaque directement l'endpoint via
// le fixture `request` (APIRequestContext), qui hérite du baseURL ET du
// storageState (cookie de session forgé). Pas de navigateur à piloter → robuste
// sur le montage lent /mnt/c.
//
// ANCRE STABLE — Famille Dupuis (DEMO.placee) : seule demande de démo de
// rep-samedi JAMAIS mutée. L'ordre d'exécution est ALPHABÉTIQUE et en SÉRIE :
// demandes-paiement.spec.ts (d) tourne AVANT export.spec.ts (e) et passe
// Camille/Élodie/Julien en soldé/remboursé. Dupuis (placée) n'est touchée par
// personne → ses cellules (4 places, 4 adultes, 0 enfant, statut « Placée »,
// soldé) sont déterministes. On assert donc SUR ELLE.
//
// NON DESTRUCTIF : tout est en LECTURE (GET). Aucune écriture sur rep-samedi —
// les deux seuls chemins de création (formulaire public et « nouvelle demande »
// admin) ciblent la 1ʳᵉ rep ouverte = rep-samedi, et de nombreux specs tournent
// APRÈS export (placement, plan, stats, smoke…) : y ajouter une demande
// fausserait leurs comptes. La vérif d'injection de formule, qui EXIGE une
// donnée malveillante, est donc en test.fixme (cf. EXP-06).
//
// PIÈGES respectés :
//  • BOM UTF-8 vérifié sur les OCTETS bruts (res.body() → 0xEF 0xBB 0xBF) : selon
//    le décodage, res.text() peut AVALER le BOM de tête → on ne s'y fie pas.
//  • Pas de getByRole('alert') (matcherait le route-announcer Next) — ici on est
//    en API, et le seul test de page (EXP-02) cible un lien par son nom.
//  • Découpe par « ; » faite UNIQUEMENT sur la ligne Dupuis, dont aucune cellule
//    ne contient « ; » (donc non entre-guillemets) : l'alignement colonne→index
//    est sûr. (À l'inverse, la ligne Élodie a une cellule « Versements »
//    multi-règlements « … ; … » entre guillemets → on ne la découpe pas.)

import { expect, test, type Page } from '@playwright/test'

import { DEMO, ROLES_AUTH } from './data'

// Session admin forgée (cf. global-setup) pour tout le fichier. Le rôle requis
// par la route est admin OU super-admin (le rôle « scan » est rejeté en 403).
test.use({ storageState: ROLES_AUTH.admin })

// En-têtes de colonnes EXACTS, dans l'ordre du markup
// (app/api/admin/export/[repId]/route.ts). Les 7 premières sont l'ossature que
// la feuille de caisse attend ; les suivantes (montants/versements/places) sont
// vérifiées par présence pour rester robuste à un ajout de colonne.
const COLONNES_TETE = ['Nom', 'Email', 'Téléphone', 'Statut', 'Places', 'Adultes', 'Enfants']
const COLONNES_RESTE = [
  'Places offertes',
  'Montant dû',
  'Payé le',
  'Reçu',
  'Reste',
  'Soldé',
  'Versements',
  'Remboursé',
  'Net',
  'Place(s) attribuée(s)',
  'Scanné',
  'Note interne',
]

test.describe('EXP — export CSV des demandes (admin)', () => {
  // ——— EXP-01 — Téléchargement nominal : 200 + type CSV + BOM + en-têtes + démo ———
  test('EXP-01 — l’admin exporte rep-samedi : 200, Content-Type CSV, BOM, en-têtes et ligne de démo', async ({
    request,
  }) => {
    const res = await request.get(`/api/admin/export/${DEMO.reps.samedi.id}`)

    // 200 + en-têtes HTTP de fichier CSV téléchargeable.
    expect(res.status()).toBe(200)
    const headers = res.headers()
    expect(headers['content-type']).toContain('text/csv')
    expect(headers['content-type']).toContain('charset=utf-8')
    expect(headers['content-disposition']).toContain('attachment')
    expect(headers['content-disposition']).toContain(`demandes-${DEMO.reps.samedi.id}.csv`)
    expect(headers['cache-control']).toContain('no-store')

    // BOM UTF-8 (Excel FR) — vérifié sur les OCTETS, pas sur le texte décodé.
    const octets = await res.body()
    expect(octets[0]).toBe(0xef)
    expect(octets[1]).toBe(0xbb)
    expect(octets[2]).toBe(0xbf)

    // Corps texte : on retire un éventuel BOM résiduel, on découpe en lignes CRLF.
    const corps = (await res.text()).replace(/^\uFEFF/, '')
    const lignes = corps.split('\r\n')

    // Ligne d'en-tête (séparateur « ; ») : ossature exacte + présence des autres.
    const entetes = lignes[0].split(';')
    expect(entetes.slice(0, COLONNES_TETE.length)).toEqual(COLONNES_TETE)
    for (const colonne of COLONNES_RESTE) expect(entetes).toContain(colonne)

    // Au moins une demande de démo : Famille Dupuis (placée, jamais mutée).
    expect(corps).toContain(DEMO.placee.name) // « Famille Dupuis »
    expect(corps).toContain(DEMO.placee.email) // marion.dupuis@example.com

    // Découpe colonne→index SÛRE : la ligne Dupuis n'a aucune cellule contenant
    // « ; » → elle n'est pas entre guillemets. (Nom non spécial → la ligne
    // commence littéralement par « Famille Dupuis;… ».)
    const ligneDupuis = lignes.find((l) => l.startsWith(DEMO.placee.name))
    expect(ligneDupuis, 'la ligne CSV de Famille Dupuis doit être présente').toBeTruthy()
    const c = ligneDupuis!.split(';')
    expect(c[0]).toBe(DEMO.placee.name) // Nom
    expect(c[1]).toBe(DEMO.placee.email) // Email
    expect(c[3]).toBe('Placée') // Statut (placed → « Placée »)
    expect(c[4]).toBe(String(DEMO.placee.partySize)) // Places = 4
    expect(c[5]).toBe('4') // Adultes (4 places, 0 enfant)
    expect(c[6]).toBe('0') // Enfants
    expect(c[8]).toBe('48,00') // Montant dû : 4 × 12,00 € (décimale FR, virgule)
    expect(c[12]).toBe('Oui') // Soldé (réglé 48 € par chèque au seed)
  })

  // ——— EXP-02 — Point d'entrée UI : le lien « Exporter en CSV » de /admin/demandes ———
  test('EXP-02 — /admin/demandes expose un lien « Exporter en CSV » vers la route', async ({
    page,
  }) => {
    // Ancre la route à son déclencheur réel dans l'UI (page Demandes). Lecture
    // seule : on lit le href, on ne le suit pas.
    await page.goto('/admin/demandes')

    const lien = page.getByRole('link', { name: 'Exporter en CSV' })
    await expect(lien).toBeVisible()
    // href = /api/admin/export/<1ʳᵉ rep par date> = rep-samedi (20 juin < 21 juin).
    await expect(lien).toHaveAttribute(
      'href',
      new RegExp(`/api/admin/export/${DEMO.reps.samedi.id}$`),
    )
  })

  // ——— EXP-05 — repId inconnu / format invalide → 404 ———
  test('EXP-05 — un repId inconnu ou de format invalide renvoie 404', async ({ request }) => {
    // Format VALIDE ([a-zA-Z0-9_-]) mais absent en base → findUnique null → 404.
    const inconnu = await request.get('/api/admin/export/rep-inexistant-e2e')
    expect(inconnu.status()).toBe(404)

    // Format INVALIDE (le « . » n'est pas dans REP_ID_RE) → 404 sans toucher la base.
    const malforme = await request.get('/api/admin/export/rep.samedi.invalide')
    expect(malforme.status()).toBe(404)
  })
})

// ——— EXP-03 — Garde de rôle : le bénévole « scan » est refusé (403) ———
test.describe('EXP — garde de rôle scan', () => {
  test.use({ storageState: ROLES_AUTH.scan })

  test('EXP-03 — une session « scan » ne peut pas exporter (403)', async ({ request }) => {
    // La session scan passe le proxy (cookie valide) mais la route la rejette :
    // l'export est réservé aux rôles admin/super-admin.
    const res = await request.get(`/api/admin/export/${DEMO.reps.samedi.id}`)
    expect(res.status()).toBe(403)
    // Corps texte « Accès refusé », surtout PAS un CSV.
    expect(res.headers()['content-type'] ?? '').not.toContain('text/csv')
  })
})

// ——— EXP-04 — Garde d'auth : sans session → 401 ———
test.describe('EXP — garde d’authentification', () => {
  // Contexte SANS cookie de session (override du storageState fichier).
  test.use({ storageState: { cookies: [], origins: [] } })

  test('EXP-04 — sans session, l’export est refusé (401) et ne renvoie aucun CSV', async ({
    request,
  }) => {
    // proxy.ts intercepte /api/admin/* non authentifié → 401 JSON
    // « non authentifié » (les pages, elles, redirigeraient vers /admin/login).
    const res = await request.get(`/api/admin/export/${DEMO.reps.samedi.id}`)
    expect(res.status()).toBe(401)
    expect(res.headers()['content-type'] ?? '').not.toContain('text/csv')
  })
})

// ——— Helper réservé au flux d'injection (EXP-06, fixme) — neutralise le
// time-trap anti-bot du formulaire public (cf. public.spec.ts). À l'epoch,
// Date.now() − ts ≫ MIN_FILL_MS → la soumission n'est pas prise pour un robot.
async function neutraliserTimeTrap(page: Page) {
  await page.locator('input[name="ts"]').waitFor({ state: 'attached' })
  await page.evaluate(() => {
    const el = document.querySelector('input[name="ts"]') as HTMLInputElement | null
    if (el) el.value = '1'
  })
}

// ——— EXP-06 — Neutralisation de l'injection de formule CSV (revue sécurité) ———
//
// test.fixme : DÉFÉRÉ et NON exécuté ici, à dessein.
//   • La route préfixe d'une apostrophe toute cellule commençant par = + - @
//     (champCsv) → empêche Excel d'exécuter « =… » comme une formule. AUCUNE
//     donnée de démo ne commence par ces caractères : pour OBSERVER la
//     neutralisation, il FAUT créer une demande au nom malveillant (ex. firstName
//     « =Injection »). Les noms n'ont aucune contrainte de caractères
//     (booking-schema.ts : trim + longueur), donc « =Injection » est une saisie
//     valide.
//   • Or les DEUX seuls chemins de création (formulaire public ET « nouvelle
//     demande » admin) ciblent la 1ʳᵉ rep ouverte = rep-samedi (hidden
//     representationId, pas de sélecteur). Y ajouter une demande POLLUERAIT
//     rep-samedi pour les specs qui tournent APRÈS (placement, plan, stats,
//     smoke…) → viole la règle d'or « non destructif ». Aucun moyen UI de router
//     la demande vers une rep neuve isolée.
//   • À débloquer le jour où l'on peut créer la donnée en isolation (ex. seed E2E
//     dédié, ou écriture Prisma directe dans la base de test depuis le runner).
//
// Le corps ci-dessous est l'implémentation cible (formulaire public, calquée sur
// public.spec.ts), prête à activer une fois l'isolation possible.
test.fixme(
  'EXP-06 — une cellule « =… » est neutralisée par une apostrophe (anti-formule Excel)',
  async ({ page, request }) => {
    // 1) Créer une demande publique au PRÉNOM malveillant « =Injection » (email
    //    unique → pas de doublon). Le time-trap est neutralisé avant l'envoi.
    const email = `e2e-${Date.now()}@test.local`
    await page.goto('/')
    await page.getByLabel('Prénom', { exact: true }).fill('=Injection')
    await page.getByLabel('Nom', { exact: true }).fill('Formule')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Téléphone', { exact: true }).fill('0612345678')
    await page.getByLabel('Nombre de places', { exact: true }).selectOption('1')
    await neutraliserTimeTrap(page)
    await page.getByRole('button', { name: 'Envoyer ma demande' }).click()
    await expect(page).toHaveURL(/\/billets\//)

    // 2) Exporter rep-samedi (session admin du fichier) et vérifier la
    //    neutralisation : la cellule est préfixée d'une apostrophe « '=Injection »
    //    et n'apparaît JAMAIS en formule brute en tête de cellule.
    const corps = (await (await request.get(`/api/admin/export/${DEMO.reps.samedi.id}`)).text())
      .replace(/^\uFEFF/, '')
    expect(corps).toContain("'=Injection Formule") // apostrophe de neutralisation
    expect(corps).not.toMatch(/(^|\r\n)=Injection/) // jamais en début de cellule/ligne
  },
)
