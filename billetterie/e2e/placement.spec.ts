// E2E — écran de placement (/admin/placement/[bookingId]).
//
// Parcours réel testé : la liste /admin/demandes → bouton « Placer » (émission)
// ou « Déplacer » (déplacement) de la LIGNE d'une demande → l'écran de placement.
// On ne connaît pas le bookingId (cuid) en dur : on passe TOUJOURS par l'UI.
//
// Mutation & ordre : valider un placement MUTE l'état (la demande passe
// « placée », sièges occupés). PLA-02 (la seule validation) est donc déclaré EN
// DERNIER, pour que PLA-01/PLA-03 voient encore Julien Moreau « à placer ».
// PLA-04 utilise la résa déjà placée du seed (Famille Dupuis) et ne fait
// qu'« Annuler le déplacement » → aucune mutation.

import { expect, test } from '@playwright/test'

import { DEMO, ROLES_AUTH } from './data'

// L'admin a accès au placement.
test.use({ storageState: ROLES_AUTH.admin })

// Compteur de sélection « N/partySize » (ancré sur l'aria-live de la colonne
// Sélection — unique sur l'écran de placement).
const COUNTER = 'p[aria-live="polite"]'

// Atteint l'écran de placement (émission) d'une demande depuis la liste.
async function ouvrirPlacement(page: import('@playwright/test').Page, nom: string) {
  await page.goto('/admin/demandes')
  const lien = page
    .getByRole('row')
    .filter({ hasText: nom })
    // exact:true : « Placer » est une sous-chaîne de « Déplacer ».
    .getByRole('link', { name: 'Placer', exact: true })
  // Attendre le rendu de la ligne avant de cliquer (1er compile /mnt/c lent),
  // puis waitForURL (navigation explicite, sans course avec le compteur).
  await expect(lien).toBeVisible()
  await lien.click()
  await page.waitForURL(/\/admin\/placement\//)
}

test('PLA-01 : l’écran de placement affiche jusqu’à 3 suggestions de partySize sièges', async ({
  page,
}) => {
  // Julien Moreau : payé, soldé, NON placé (2 places).
  await ouvrirPlacement(page, DEMO.payeeSoldee.name)

  const size = DEMO.payeeSoldee.partySize // 2
  await expect(page.getByRole('heading', { name: /Placement.*Julien Moreau/ })).toBeVisible()

  // 3 emplacements de suggestion sont rendus (boutons), certains désactivés si
  // le moteur en a trouvé moins de 3.
  await expect(page.getByRole('button', { name: /^Suggestion \d/ })).toHaveCount(3)

  // Au moins une suggestion exploitable (la salle de démo a de la place pour 2).
  const proposees = page.locator('button:enabled').filter({ hasText: /Suggestion \d/ })
  const n = await proposees.count()
  expect(n).toBeGreaterThanOrEqual(1)
  expect(n).toBeLessThanOrEqual(3)

  // La suggestion 1 est pré-appliquée au chargement → compteur déjà à partySize.
  await expect(page.locator(COUNTER)).toContainText(`${size}/${size}`)

  // Chaque suggestion concerne EXACTEMENT partySize sièges : cliquer une
  // suggestion remplace la sélection par ses sièges → le compteur reste N/N.
  for (let i = 0; i < n; i++) {
    await proposees.nth(i).click()
    await expect(page.locator(COUNTER)).toContainText(`${size}/${size}`)
  }
})

test('PLA-03 : le plafond bloque la validation sous partySize et la désélection est possible', async ({
  page,
}) => {
  // Cas FIABLE sans clic SVG : on pilote le plafond via le compteur + le bouton
  // « Tout désélectionner ». La sélection siège-par-siège sur le plan est
  // couverte (en test.fixme) plus bas.
  await ouvrirPlacement(page, DEMO.payeeSoldee.name)
  const size = DEMO.payeeSoldee.partySize // 2

  // Suggestion 1 pré-appliquée → plafond atteint, validation possible.
  await expect(page.locator(COUNTER)).toContainText(`${size}/${size}`)
  await expect(page.getByText(/Plafond atteint/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Valider ce placement' })).toBeEnabled()

  // Désélection possible (en masse) → sous le plafond, validation bloquée.
  await page.getByRole('button', { name: 'Tout désélectionner' }).click()
  await expect(page.locator(COUNTER)).toContainText(`0/${size}`)
  await expect(page.getByRole('button', { name: 'Valider ce placement' })).toBeDisabled()
  await expect(page.getByText(/Sélectionnez exactement 2 places? pour valider/)).toBeVisible()
})

test.fixme(
  'PLA-03 (manuel) : la sélection sur le plan SVG est plafonnée à partySize',
  async ({ page }) => {
    // FIXME — à valider à l'exécution : dépend du rendu SVG de <SeatMap />.
    // Hypothèse à confirmer : en dev (next dev / Turbopack) les classes
    // CSS-modules conservent le nom local, donc `circle[class*="clickable"]`
    // cible les sièges cliquables, `[class*="selected"]` les sélectionnés et
    // `[class*="libre"]` les libres. Si le hash masque le nom local, ancrer
    // autrement (p. ex. exposer un data-seat-* sur le <g> du siège dans
    // seat-map.tsx).  // TODO sélecteur fragile (classes CSS-modules)
    // À vérifier : (1) on peut sélectionner exactement `size` sièges ; (2) au
    // plafond, un siège libre verrouillé ne s'ajoute plus ; (3) désélectionner
    // repasse sous le plafond.
    await ouvrirPlacement(page, DEMO.payeeSoldee.name)
    const size = DEMO.payeeSoldee.partySize // 2
    const counter = page.locator(COUNTER)

    // Repartir d'une sélection vide pour piloter la sélection à la main.
    await page.getByRole('button', { name: 'Tout désélectionner' }).click()
    await expect(counter).toContainText(`0/${size}`)

    // Sélectionner `size` sièges libres encore cliquables (donc non sélectionnés).
    const ajoutables = page.locator('circle[class*="clickable"]:not([class*="selected"])')
    for (let i = 0; i < size; i++) {
      await ajoutables.first().click()
      await expect(counter).toContainText(`${i + 1}/${size}`)
    }

    // Plafond : validation possible, message de plafond, plus aucun siège
    // libre non sélectionné n'est cliquable (lockUnselected).
    await expect(page.getByRole('button', { name: 'Valider ce placement' })).toBeEnabled()
    await expect(page.getByText(/Plafond atteint/)).toBeVisible()
    await expect(ajoutables).toHaveCount(0)

    // Tenter un siège libre VERROUILLÉ ne change pas le compteur.
    await page
      .locator('circle[class*="libre"]:not([class*="clickable"])')
      .first()
      .click({ force: true })
    await expect(counter).toContainText(`${size}/${size}`)

    // Désélection possible : retirer un siège sélectionné repasse sous le plafond.
    await page.locator('circle[class*="selected"]').first().click()
    await expect(counter).toContainText(`${size - 1}/${size}`)
  },
)

test('PLA-04 : déplacer une demande placée pré-sélectionne ses places et « Annuler » revient sans rien changer', async ({
  page,
}) => {
  // Famille Dupuis : déjà placée dans le seed (4 places). Non mutant : on annule.
  await page.goto('/admin/demandes')
  await page
    .getByRole('row')
    .filter({ hasText: DEMO.placee.name })
    .getByRole('link', { name: 'Déplacer', exact: true })
    .click()
  await expect(page).toHaveURL(/\/admin\/placement\/[^?]+\?mode=deplacer/)

  const size = DEMO.placee.partySize // 4
  await expect(page.getByRole('heading', { name: /Déplacement.*Famille Dupuis/ })).toBeVisible()
  // Places actuelles pré-sélectionnées → compteur déjà à partySize.
  await expect(page.locator(COUNTER)).toContainText(`${size}/${size}`)

  // « Annuler le déplacement » → retour à la liste, aucune mutation.
  await expect(page.getByRole('button', { name: 'Annuler le déplacement' })).toBeVisible()
  await page.getByRole('button', { name: 'Annuler le déplacement' }).click()
  await expect(page).toHaveURL(/\/admin\/demandes/)
  // La demande est toujours « Placée ».
  await expect(
    page.getByRole('row').filter({ hasText: DEMO.placee.name }),
  ).toContainText('Placée')
})

// ⚠️ EN DERNIER : valide réellement un placement → MUTE l'état (Julien passe
// « placée »). Doit suivre PLA-01/PLA-03 qui le veulent encore « à placer ».
test('PLA-02 : valider la 1ʳᵉ suggestion place la demande (retour liste, statut « Placée »)', async ({
  page,
}) => {
  await ouvrirPlacement(page, DEMO.payeeSoldee.name)
  const size = DEMO.payeeSoldee.partySize // 2

  // Appliquer la suggestion 1 (idempotent : déjà pré-appliquée) puis valider.
  await page.getByRole('button', { name: /^Suggestion 1\b/ }).click()
  const valider = page.getByRole('button', { name: 'Valider ce placement' })
  await expect(valider).toBeEnabled()
  await expect(page.locator(COUNTER)).toContainText(`${size}/${size}`)
  await valider.click()

  // Succès → redirection serveur vers la liste des demandes.
  await expect(page).toHaveURL(/\/admin\/demandes/)
  // Julien Moreau est désormais « Placée » (billets émis) et propose « Déplacer ».
  const ligne = page.getByRole('row').filter({ hasText: DEMO.payeeSoldee.name })
  await expect(ligne).toContainText('Placée')
  await expect(ligne.getByRole('link', { name: 'Déplacer', exact: true })).toBeVisible()
})
