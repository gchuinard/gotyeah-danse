// Parcours PUBLICS (demande de places, accès « j'ai déjà une demande ») + une
// garde de sécurité admin. Socle imposé : e2e/data.ts (DEMO) + playwright.config.ts
// (baseURL, série workers:1, base seedée fraîche). On NE modifie PAS le socle.
//
// Pièges du produit, gérés ici :
//  • TIME-TRAP anti-bot (app/demande/actions.ts, MIN_FILL_MS = 2500) : une
//    soumission du formulaire de demande MOINS de 2,5 s après le rendu serveur
//    renvoie un FAUX succès (« Merci, votre demande a bien été enregistrée »)
//    SANS rien créer ni rediriger — et court-circuite même la validation zod.
//    → on patiente AVANT chaque envoi réel du formulaire de demande.
//  • Turnstile DÉSACTIVÉ en test (TURNSTILE_SECRET_KEY vide) : pas de CAPTCHA,
//    bouton d'envoi actif d'emblée.
//  • Tests EN SÉRIE sur base seedée MUTABLE : une création publique change la
//    jauge et pose un doublon d'email → email UNIQUE par test qui crée.

import { expect, test, type Page } from '@playwright/test'

import { codeDemande } from '../lib/booking/code'
import { DEMO } from './data'

// Neutralise le time-trap anti-bot (app/demande/actions.ts, MIN_FILL_MS = 2500)
// de façon DÉTERMINISTE : plutôt que de parier sur un délai vs l'hydratation
// (flaky), on force le champ caché `ts` à l'epoch → Date.now() − ts ≫ 2500, donc
// l'envoi n'est jamais pris pour un robot. À appeler juste avant l'envoi (après
// avoir rempli les champs ; le serveur lit la valeur du DOM à la soumission).
async function neutraliserTimeTrap(page: Page) {
  await page.locator('input[name="ts"]').waitFor({ state: 'attached' })
  await page.evaluate(() => {
    const el = document.querySelector('input[name="ts"]') as HTMLInputElement | null
    if (el) el.value = '1'
  })
}

test.describe('PUB — formulaire public de demande', () => {
  test('PUB-01 : une demande valide redirige vers /billets et affiche identifiant + montant', async ({
    page,
  }) => {
    const email = `e2e-${Date.now()}@test.local` // unique → évite la détection de doublon
    await page.goto('/')

    // Onglet « Nouvelle demande » actif par défaut. Libellés EXACTS du markup
    // (app/demande/demande-form.tsx).
    await page.getByLabel('Prénom', { exact: true }).fill('Camille')
    await page.getByLabel('Nom', { exact: true }).fill('Testeur')
    await page.getByLabel('Email', { exact: true }).fill(email)
    // Téléphone : masque FR (formatFrPhone) — on saisit les chiffres, le champ
    // se reformate en « 06 12 34 56 78 » ; le serveur renormalise à l'envoi.
    await page.getByLabel('Téléphone', { exact: true }).fill('0612345678')
    await page.getByLabel('Nombre de places', { exact: true }).selectOption('2')
    await page.getByLabel('Dont enfants (tarif réduit)', { exact: true }).selectOption('1')

    // Sans ça : faux succès du time-trap, aucune redirection.
    await neutraliserTimeTrap(page)
    await page.getByRole('button', { name: 'Envoyer ma demande' }).click()

    await expect(page).toHaveURL(/\/billets\//)
    await expect(page.getByRole('heading', { name: 'Demande enregistrée' })).toBeVisible()
    await expect(page.getByText(/Votre identifiant de demande/)).toBeVisible()
    // 2 places dont 1 enfant, tarifs 12/6 → 1 adulte (12,00) + 1 enfant (6,00) = 18,00 €.
    await expect(page.getByText(/Montant à régler/)).toContainText('18,00')
  })

  test('PUB-02 : le montant indicatif se recalcule quand on change places / enfants', async ({
    page,
  }) => {
    await page.goto('/')
    // Paragraphe d'estimation sous « Dont enfants » (tarifs 12/6 définis au seed).
    // TODO sélecteur fragile : ancré sur la copie « À régler au studio » (la
    // classe CSS est un hash de module → inutilisable).
    const estimation = page.getByText(/À régler au studio/)
    // 1 place, 0 enfant → 1 adulte × 12,00 €.
    await expect(estimation).toContainText('12,00')
    // 2 places → 2 adultes × 12,00 € = 24,00 €.
    await page.getByLabel('Nombre de places', { exact: true }).selectOption('2')
    await expect(estimation).toContainText('24,00')
    // dont 1 enfant → 1 adulte + 1 enfant = 18,00 €.
    await page.getByLabel('Dont enfants (tarif réduit)', { exact: true }).selectOption('1')
    await expect(estimation).toContainText('enfant')
    await expect(estimation).toContainText('18,00')
  })

  test('PUB-03 : un email invalide affiche une erreur et ne redirige pas', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Prénom', { exact: true }).fill('Camille')
    await page.getByLabel('Nom', { exact: true }).fill('Testeur')
    await page.getByLabel('Téléphone', { exact: true }).fill('0612345678')
    await page.getByLabel('Email', { exact: true }).fill('pas-un-email')

    // Sans ça : le time-trap renverrait un faux succès AVANT zod.
    await neutraliserTimeTrap(page)
    await page.getByRole('button', { name: 'Envoyer ma demande' }).click()

    // Erreur par champ (zod) + bandeau global (role="alert").
    await expect(page.getByText('Adresse email invalide.')).toBeVisible()
    await expect(page.getByText('Veuillez corriger les champs signalés.')).toBeVisible()
    // Pas de redirection : on reste sur le formulaire.
    await expect(page).not.toHaveURL(/\/billets\//)
    await expect(page.getByRole('button', { name: 'Envoyer ma demande' })).toBeVisible()
  })
})

test.describe('ACC — accès « j’ai déjà une demande »', () => {
  test('ACC-01 : email + identifiant valides redirigent vers la demande', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /déjà une demande/ }).click()

    // Le sous-formulaire « identifiant oublié » est replié par défaut → il n'y a
    // qu'un seul champ « Email » dans le DOM (acces-email).
    // Thomas (rep-dimanche) plutôt que Camille : les specs paiement (qui tournent
    // avant) passent Camille en « payée » → sa page n'affiche plus « Demande
    // enregistrée ». Thomas n'est muté par personne.
    await page.getByLabel('Email', { exact: true }).fill(DEMO.enAttenteDimanche.email)
    await page
      .getByLabel('Identifiant de demande', { exact: true })
      .fill(codeDemande(DEMO.enAttenteDimanche.token))
    await page.getByRole('button', { name: 'Accéder à ma demande' }).click()

    // Redirection vers la demande (statut « en attente » → titre pending).
    await expect(page).toHaveURL(new RegExp(`/billets/${DEMO.enAttenteDimanche.token}`))
    await expect(page.getByRole('heading', { name: 'Demande enregistrée' })).toBeVisible()
  })

  test('ACC-02 : un identifiant erroné affiche une erreur générique sans rediriger', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /déjà une demande/ }).click()

    // Même format (6 car.) mais garanti ≠ du vrai identifiant → résultat « introuvable ».
    const vrai = codeDemande(DEMO.enAttente.token)
    const faux = (vrai[0] === 'A' ? 'Z' : 'A') + vrai.slice(1)
    await page.getByLabel('Email', { exact: true }).fill(DEMO.enAttente.email)
    await page.getByLabel('Identifiant de demande', { exact: true }).fill(faux)
    await page.getByRole('button', { name: 'Accéder à ma demande' }).click()

    await expect(page.getByText('Email ou identifiant incorrect')).toBeVisible()
    await expect(page).not.toHaveURL(/\/billets\//)
  })
})

test.describe('SEC — gardes d’accès', () => {
  test('SEC-01 : /admin/demandes sans session redirige vers /admin/login', async ({ page }) => {
    // Contexte par défaut = NON authentifié (aucun storageState appliqué).
    await page.goto('/admin/demandes')
    await expect(page).toHaveURL(/\/admin\/login/)
  })
})
