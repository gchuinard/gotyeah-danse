// Smoke du socle E2E : prouve que (1) le serveur de test + le seed tournent,
// (2) la base contient les données de démo, (3) l'auth FORGÉE par rôle marche,
// (4) la garde admin redirige. Si ce fichier passe, le socle est sain.

import { expect, test } from '@playwright/test'

import { DEMO, ROLES_AUTH } from './data'

test('public : la page d’accueil affiche le formulaire de demande', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('form').first()).toBeVisible()
})

test('garde admin : /admin/demandes sans session → /admin/login', async ({ page }) => {
  await page.goto('/admin/demandes')
  await expect(page).toHaveURL(/\/admin\/login/)
})

test.describe('admin authentifié (session forgée)', () => {
  test.use({ storageState: ROLES_AUTH.admin })

  test('accède aux demandes et voit les données de démo', async ({ page }) => {
    await page.goto('/admin/demandes')
    await expect(page).toHaveURL(/\/admin\/demandes/)
    await expect(page.getByText(DEMO.enAttente.name)).toBeVisible()
  })
})

test.describe('rôle scan (session forgée)', () => {
  test.use({ storageState: ROLES_AUTH.scan })

  test('un bénévole scan est renvoyé hors des demandes', async ({ page }) => {
    await page.goto('/admin/demandes')
    // Rôle insuffisant → redirigé vers son accueil (la page de scan).
    await expect(page).toHaveURL(/\/admin\/scan/)
  })
})
