// E2E — /admin/salles (super-admin only). Couvre la LISTE des salles
// enregistrées et le CRÉATEUR de salle (/admin/salles/nouvelle), en LECTURE +
// saisie locale uniquement. Tout y est NON DESTRUCTIF :
//
//  • Le créateur (builder-view.tsx) est 100 % client : parser + générateur purs,
//    aperçu live (SeatMap SVG). Saisir le nom / éditer un rang ne touche PAS la
//    base — donc safe à tester en série sur la base partagée.
//  • La liste (salles/page.tsx) ne fait que LIRE (prisma.venue.findMany). En env
//    de test, aucun VENUE_ID et aucune Venue seedée → la « salle en service » est
//    la salle INTÉGRÉE par défaut : « Centre Culturel de Bergerac ». On ancre
//    dessus (stable, jamais active car la RÈGLE D'OR interdit d'activer une salle).
//
// ⚠️ DESTRUCTIF → test.fixme (NON exécuté par Playwright) : activer une salle,
// « Réappliquer le plan » et « Revenir à la salle par défaut » relancent
// syncPlan() → re-matérialisent Section/Row/Seat → casseraient les démos de
// placement/scan des autres specs. « Enregistrer dans la billetterie » persiste
// une Venue dans la base partagée. Ces flux sont documentés en fixme.
//
// PIÈGES respectés :
//  • role="alert" (route-announcer Next) évité → on assert par getByText / par
//    rôle non ambigu (img, status, checkbox).
//  • Le builder DUPLIQUE les libellés « Largeur d'un siège (px) » / « Largeur des
//    allées (px) » (toolbar par-rang ET géométrie globale) → getByLabel y serait
//    ambigu (strict mode). On ne cible donc PAS ces champs ; la preuve de
//    réactivité passe par le nom de salle (unique) → caption du SeatMap.

import { expect, test } from '@playwright/test'

import { ROLES_AUTH } from './data'

// /admin/salles est réservé au SUPER-ADMIN (requireSuperAdmin). Session forgée
// par le global-setup (role: 'super-admin').
test.use({ storageState: ROLES_AUTH['super-admin'] })

test.describe('Admin — salles (super-admin)', () => {
  // ——— SALLE-01 — Liste : salle par défaut affichée ———
  test('SALLE-01 — la liste s’ouvre et affiche la salle par défaut (Bergerac)', async ({ page }) => {
    await page.goto('/admin/salles')
    await expect(page).toHaveURL(/\/admin\/salles$/)
    await expect(page.getByRole('heading', { name: 'Salles', level: 1 })).toBeVisible()

    // « Salle en service » : aucune Venue active (règle d'or) → la salle intégrée
    // par défaut fait foi. On scope le <p> par son texte puis on vérifie le nom +
    // le marqueur « par défaut » (le <strong> et le suffixe sont des nœuds frères).
    const enService = page.getByText(/Salle en service/)
    await expect(enService).toContainText('Centre Culturel de Bergerac')
    await expect(enService).toContainText('par défaut')

    // Lien vers le créateur (href ancré ; libellé « + Créer une salle »).
    const creer = page.getByRole('link', { name: /Créer une salle/ })
    await expect(creer).toHaveAttribute('href', '/admin/salles/nouvelle')

    // Bloc d'aide toujours rendu (indépendant des Venue) : phrase unique, évite la
    // collision avec un éventuel bouton « Activer » d'une carte de salle.
    await expect(page.getByText(/applique le plan immédiatement/)).toBeVisible()
  })

  // ——— SALLE-02 — Créateur : charge, aperçu live réactif, export JSON ———
  test('SALLE-02 — /salles/nouvelle charge, l’aperçu réagit à une saisie et « Télécharger …json » est présent', async ({
    page,
  }) => {
    await page.goto('/admin/salles/nouvelle')
    await expect(page.getByRole('heading', { name: 'Créer une salle', level: 1 })).toBeVisible()

    // Relevé par défaut (EXEMPLE = 3 rangs A/B/C). Les cases « Sélectionner le
    // rang X » portent un aria-label exact → ancrage robuste.
    await expect(page.getByRole('checkbox', { name: 'Sélectionner le rang A' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Sélectionner le rang B' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Sélectionner le rang C' })).toBeVisible()

    // Barre de stats (role="status", distincte du route-announcer role=alert) :
    // « 3 rangs · N places ». Prouve que le générateur a tourné côté client.
    const stats = page.getByRole('status')
    await expect(stats).toContainText('3 rangs')
    await expect(stats).toContainText('places')

    // Aperçu : le SeatMap est un <svg role="img"> dont le nom accessible est la
    // caption « Aperçu — {nom} (géométrie indicative) ». Présent dès qu'un rang
    // est valide (cas par défaut).
    await expect(page.getByRole('img', { name: /Aperçu — Ma salle/ })).toBeVisible()

    // « Télécharger …json » présent ET actif (pret = aucune erreur + config OK).
    // Regex sur le slug car le nom de fichier suit le nom de salle.
    const telecharger = page.getByRole('button', { name: /Télécharger .*\.json/ })
    await expect(telecharger).toBeVisible()
    await expect(telecharger).toBeEnabled()

    // Bouton d'enregistrement présent (on NE clique PAS : persisterait une Venue,
    // cf. SALLE-05 fixme).
    await expect(
      page.getByRole('button', { name: 'Enregistrer dans la billetterie' }),
    ).toBeVisible()

    // ── Réactivité live : changer le NOM (champ unique « Nom de la salle ») doit
    // mettre à jour la caption de l'aperçu (état React → re-render du SeatMap).
    await page.getByLabel('Nom de la salle').fill('Studio E2E')
    await expect(page.getByRole('img', { name: /Aperçu — Studio E2E/ })).toBeVisible()
    // L'ancienne caption a disparu → preuve que l'aperçu a bien réagi.
    await expect(page.getByRole('img', { name: /Aperçu — Ma salle/ })).toHaveCount(0)
  })

  // ——— Flux DESTRUCTIFS / PERSISTANTS — test.fixme (NON exécutés) ———
  // Ils relancent syncPlan() (re-matérialise le plan) ou écrivent en base
  // partagée → casseraient les specs de placement/scan exécutées en série. À
  // valider à la main ou sur une base jetable dédiée. Corps laissé à titre
  // indicatif ; test.fixme garantit la NON-exécution.

  // SALLE-03 — Activer une salle re-synchronise le plan (DESTRUCTIF).
  test.fixme(
    'SALLE-03 — activer une salle resynchronise le plan (destructif, non exécuté)',
    async ({ page }) => {
      await page.goto('/admin/salles')
      // Pré-requis : une Venue NON active, créée de façon ISOLÉE (sinon rien à
      // activer en env de test). La carte de salle est un <li> ; le bouton est
      // dans un <form action={activerSalleAction}>.
      const carte = page.getByRole('listitem').filter({ hasText: 'Ma salle e2e' })
      await carte.getByRole('button', { name: 'Activer' }).click()
      // Bandeau de succès (?ok=) : « … activée — N places, M rangées. »
      await expect(page.getByText(/activée —/)).toBeVisible()
    },
  )

  // SALLE-04 — « Réappliquer le plan » re-synchronise depuis la salle active
  // (DESTRUCTIF). Le bouton n'apparaît QUE si une salle est active.
  test.fixme(
    'SALLE-04 — « Réappliquer le plan » resynchronise (destructif, non exécuté)',
    async ({ page }) => {
      await page.goto('/admin/salles')
      await page.getByRole('button', { name: 'Réappliquer le plan' }).click()
      await expect(page.getByText(/Plan réappliqué —/)).toBeVisible()
    },
  )

  // SALLE-05 — « Enregistrer dans la billetterie » crée une Venue en base
  // (PERSISTANT : modifie la liste pour les exécutions suivantes). Le créateur
  // est pourtant safe en lecture ; seul ce clic écrit.
  test.fixme(
    'SALLE-05 — enregistrer une salle crée une Venue (persistant, non exécuté)',
    async ({ page }) => {
      await page.goto('/admin/salles/nouvelle')
      await page.getByLabel('Nom de la salle').fill(`Salle e2e ${Date.now()}`)
      await page.getByRole('button', { name: 'Enregistrer dans la billetterie' }).click()
      // Redirection vers la liste avec bandeau ?ok= « … enregistrée — … ».
      await expect(page).toHaveURL(/\/admin\/salles\?ok=/)
    },
  )
})
