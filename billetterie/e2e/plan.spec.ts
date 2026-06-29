// E2E — /admin/plan (vue plan de salle dédiée, multi-bénévoles).
//
// ⚠️ NON DESTRUCTIF. Ce fichier privilégie le SMOKE D'AFFICHAGE :
//  • la page charge (h1 + URL) ;
//  • le plan SVG s'affiche (sièges = <circle>, rangs, scène) ;
//  • les compteurs (dl) sont cohérents (Capacité = nb de sièges rendus) ;
//  • le sélecteur de représentation bascule (navigation, lecture seule) ;
//  • le mode « Gérer les sièges » s'ouvre/se ferme (état CLIENT seul).
// La SEULE interaction destructive — le cycle d'un siège (cyclerSiege →
// SeatOverride / Seat.removable, qui fausserait scan & placement) — est mise en
// test.fixme commenté (PLAN-04).
//
// Pièges respectés (cf. consignes E2E) :
//  • Build de PROD (playwright.config → next build) ⇒ classes CSS-modules
//    HACHÉES : on n'ancre JAMAIS sur une classe. On cible role/aria-label/texte
//    et la structure (dl > div … dd).
//  • La nav du back-office contient un LIEN « Plan de salle » : le titre est
//    ciblé via getByRole('heading', { level: 1 }), pas getByText.
//  • Un <div> entoure chaque <dt>/<dd> → annule les rôles ARIA term/definition :
//    on cible les stats par structure CSS (dl > div … dd), pas getByRole.
//  • Base PARTAGÉE, tests EN SÉRIE, fichiers par ordre alphabétique
//    (placement.spec MUTE avant ce fichier : Julien Moreau passe « placé » sur
//    rep-samedi). On n'assert donc aucun compteur EXACT muté par d'autres specs :
//    on s'ancre sur des invariants stables (Capacité = nb de cercles) et sur la
//    démo placée GARANTIE par le seed (Famille Dupuis, centre rang R, jamais
//    dé-placée). occupés ≥ partySize de Dupuis (plancher sûr).
//  • /mnt/c lent ⇒ on s'appuie sur l'auto-retry de expect(), aucun délai fixe.

import { expect, test, type Page } from '@playwright/test'

import { DEMO, ROLES_AUTH } from './data'

// Parcours réservé à l'admin : on prend le rôle le plus large.
test.use({ storageState: ROLES_AUTH['super-admin'] })

// ——— Helpers ancrés dans le markup réel (plan-view.tsx) ———

// <select> du sélecteur de représentation : le <label> englobant porte le texte
// « Représentation ». On vise le <select> interne plutôt que getByLabel (le nom
// accessible d'un <select> peut inclure le texte de ses <option>).
const repSelect = (page: Page) =>
  page.locator('label').filter({ hasText: 'Représentation' }).locator('select')

// <dd> d'une statistique du bandeau (dl > div > dt/dd). Le <div> autour annule
// les rôles ARIA → on passe par la structure CSS.
const statDd = (page: Page, label: string) =>
  page.locator('dl > div').filter({ hasText: label }).locator('dd')

test.describe('Plan de salle (admin)', () => {
  // ——— PLAN-01 — La page charge et le plan SVG s'affiche (sièges/rangs/scène) ———
  test('PLAN-01 : la page affiche le plan SVG (sièges, rang R placé, scène) et des stats cohérentes', async ({
    page,
  }) => {
    await page.goto('/admin/plan')
    await expect(page).toHaveURL(/\/admin\/plan/)
    await expect(page.getByRole('heading', { name: 'Plan de salle', level: 1 })).toBeVisible()

    // Le plan : <svg role="img" aria-label="Plan de salle"> (caption absent en
    // consultation).
    const svg = page.getByRole('img', { name: 'Plan de salle' })
    await expect(svg).toBeVisible()

    // Sièges : un <circle> par fauteuil (754 au seed). On reste tolérant à une
    // évolution de salle : seuil large, puis invariant exact ci-dessous.
    const sieges = svg.locator('circle')
    const nbSieges = await sieges.count()
    expect(nbSieges).toBeGreaterThan(100)

    // Invariant fort : le compteur « Capacité » = nombre de sièges dessinés.
    await expect(statDd(page, 'Capacité')).toHaveText(String(nbSieges))

    // La scène est dessinée (géométrie complète du plan).
    await expect(svg.getByText('SCÈNE')).toBeVisible()

    // Rangs + occupant : la démo placée (Famille Dupuis) occupe le rang R centre
    // — seuls les billets émis portent un nom d'occupant dans l'aria-label. Le
    // seed GARANTIT ces sièges (seedDemoTickets jette s'ils manquent) → ancre
    // stable pour « le plan reflète les rangs et les places attribuées ».
    const placesDupuis = svg.locator(`[aria-label*="${DEMO.placee.name}"]`)
    await expect(placesDupuis.first()).toBeAttached()
    await expect(placesDupuis.first()).toHaveAttribute(
      'aria-label',
      new RegExp(`Rang ${DEMO.placee.rang} `), // « Rang R … »
    )

    // Compteur « Occupés » : numérique, et ≥ aux 4 places de Dupuis (plancher
    // garanti par le seed ; d'autres specs ne font qu'AUGMENTER l'occupation).
    const occupes = statDd(page, 'Occupés')
    await expect(occupes).toHaveText(/^\d+$/)
    expect(Number(await occupes.textContent())).toBeGreaterThanOrEqual(DEMO.placee.partySize)
  })

  // ——— PLAN-02 — Sélecteur de représentation (navigation, lecture seule) ———
  test('PLAN-02 : changer de représentation recharge le plan de l’autre date', async ({ page }) => {
    await page.goto('/admin/plan')

    const select = repSelect(page)
    // Défaut = 1ʳᵉ représentation par startsAt asc = le samedi (seed).
    await expect(select).toHaveValue(DEMO.reps.samedi.id)
    // Les deux représentations du seed sont proposées (libellés = titre + date).
    await expect(select.locator('option')).toHaveCount(2)
    await expect(select).toContainText(DEMO.reps.samedi.title)
    await expect(select).toContainText(DEMO.reps.dimanche.title)

    // Bascule vers dimanche → router.push (?rep=…) + remontage (key=repId).
    await select.selectOption(DEMO.reps.dimanche.id)
    await expect(page).toHaveURL(new RegExp(`[?&]rep=${DEMO.reps.dimanche.id}`))
    await expect(repSelect(page)).toHaveValue(DEMO.reps.dimanche.id)

    // Le plan reste affiché ET reflète l'autre représentation : la résa placée
    // du samedi (Famille Dupuis) n'a aucun billet côté dimanche.
    const svg = page.getByRole('img', { name: 'Plan de salle' })
    await expect(svg).toBeVisible()
    await expect(svg.locator(`[aria-label*="${DEMO.placee.name}"]`)).toHaveCount(0)
  })

  // ——— PLAN-03 — Mode « Gérer les sièges » : ouverture/fermeture (état CLIENT) ———
  test('PLAN-03 : ouvrir puis fermer le mode « Gérer les sièges » (sans modifier l’état)', async ({
    page,
  }) => {
    await page.goto('/admin/plan')

    // Consultation : le panneau d'édition n'est pas monté.
    await expect(page.getByRole('heading', { name: 'Gérer les sièges' })).toHaveCount(0)

    // Ouvrir le mode édition. setMode() est PUREMENT client (aucune mutation
    // serveur tant qu'on ne CLIQUE PAS un siège — couvert en fixme PLAN-04).
    await page.getByRole('button', { name: 'Gérer les sièges' }).click()
    await expect(page.getByRole('heading', { name: 'Gérer les sièges' })).toBeVisible()
    // Le sélecteur de raison du blocage apparaît (label englobant → select).
    await expect(
      page.locator('label').filter({ hasText: 'Raison du blocage' }).locator('select'),
    ).toBeVisible()
    // Le SVG passe en mode édition : son aria-label porte la consigne de cycle.
    await expect(page.getByRole('img', { name: /Mode édition/ })).toBeVisible()

    // Fermer → retour consultation : le bouton réapparaît et le SVG reprend son
    // libellé « Plan de salle » (caption retirée).
    await page.getByRole('button', { name: 'Terminer' }).click()
    await expect(page.getByRole('button', { name: 'Gérer les sièges' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Plan de salle' })).toBeVisible()
  })

  // ——— PLAN-04 — Cycle d'un siège : DESTRUCTIF → non joué ———
  //
  // ⚠️ test.fixme : MUTE l'état PARTAGÉ. Un clic = un cran de cycle (cyclerSiege,
  // server action) :
  //   valide → bloqué (SeatOverride) → réservé PMR (SeatOverride) →
  //   amovible (Seat.removable, GLOBAL toutes représentations) → valide.
  // Un cycle COMPLET (4 clics) revient à « valide » → net nul. Mais :
  //  • interrompu (1–3 clics), il laisse un SeatOverride/removable qui FAUSSE le
  //    scan et le placement (cf. RÈGLE D'OR non destructif) ;
  //  • en build de prod (next build), les classes CSS-modules sont HACHÉES : on
  //    ne peut pas cibler les sièges par classe → on s'ancre sur le PRÉFIXE
  //    stable de l'aria-label (« Rang … place … »), conservé quand le suffixe
  //    d'état change ;
  //  • le clic SVG dépend du rendu de <SeatMap /> (zoom/pan, seuil 5 px).
  // À jouer MANUELLEMENT, sur un siège HORS bookings de démo (ici rang A, fond de
  // salle, score le plus bas → jamais choisi par le moteur ; ≠ rang R centre).
  test.fixme(
    'PLAN-04 (manuel) : un cycle complet de siège revient à « valide » (net nul)',
    async ({ page }) => {
      await page.goto('/admin/plan')
      await page.getByRole('button', { name: 'Gérer les sièges' }).click()
      const svg = page.getByRole('img', { name: /Mode édition/ })

      // Premier siège de la rangée A. L'ancre est le préfixe d'aria-label
      // (« Rang A place … »), stable quand le suffixe d'état est ajouté ; .first()
      // pointe le même fauteuil tout au long du cycle (l'ordre DOM ne bouge pas).
      const cible = svg.locator('circle[aria-label^="Rang A place"]').first()
      await expect(cible).toBeAttached()

      // valide → bloqué
      await cible.click()
      await expect(cible).toHaveAttribute('aria-label', /bloqué/)
      // bloqué → réservé PMR
      await cible.click()
      await expect(cible).toHaveAttribute('aria-label', /réservé PMR/)
      // réservé PMR → amovible
      await cible.click()
      await expect(cible).toHaveAttribute('aria-label', /amovible/)
      // amovible → valide : retour à l'état initial (aucun override, non amovible).
      await cible.click()
      await expect(cible).not.toHaveAttribute('aria-label', /bloqué|PMR|amovible/)
    },
  )
})
