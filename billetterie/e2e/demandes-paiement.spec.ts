// E2E — Gestion des demandes & des paiements (admin). Couvre le cahier de test
// sections ADM-01 (liste + filtres), ADM-02 (versement → soldé), ADM-03
// (acompte puis solde), ADM-04 (remboursement) et ADM-06 (création + doublon
// bloquant par email).
//
// Mécanique testée : la liste /admin/demandes ouvre, au clic sur une ligne, une
// POPUP « centre d'actions » (ConfirmDialog, role="alertdialog") qui RESTE
// OUVERTE après chaque action serveur (useActionState, pas de navigation) ; les
// montants et chips se rafraîchissent via revalidatePath. On assert donc l'état
// PERSISTANT d'après-revalidation (récap dû/reçu/reste, chips de la ligne), pas
// les messages inline transitoires : le formulaire « Ajouter un versement » est
// remonté par sa `key` (= nb de versements) à chaque ajout, ce qui efface son
// message de succès.
//
// HYPOTHÈSE D'ENVIRONNEMENT : base SEEDÉE FRAÎCHE au démarrage du webServer
// (cf. playwright.config.ts → pnpm db:seed). Chaque test mutant cible une
// réservation de démo DÉDIÉE (Camille / Élodie / Julien) pour rester
// indépendant en série. Les tests ne sont pas conçus pour une base déjà mutée
// (réexécution locale sans reseed).
//
// PIÈGE DATE : le seed fixe les dates en juin 2026 et expiresAt = createdAt+14j.
// À la date d'exécution réelle, Camille (DEMO.enAttente) est EXPIRÉE → sa
// section paiement affiche un rappel et n'expose le formulaire de versement
// qu'APRÈS prolongation. ADM-02 prolonge donc la demande au besoin (conditionnel
// → robuste que la demande soit expirée ou non).

import { expect, test, type Page } from '@playwright/test'

import { DEMO, ROLES_AUTH } from './data'

// Session admin forgée (cf. global-setup). Tous les tests de ce fichier.
test.use({ storageState: ROLES_AUTH.admin })

// ——— Helpers ancrés dans le markup réel ———

// Ligne (TR) de la demande portant ce nom — exclut l'en-tête de table et la
// popup (qui est un <div role="alertdialog">, pas une row).
const ligne = (page: Page, nom: string) => page.getByRole('row').filter({ hasText: nom })

// Ouvre la popup d'une demande en cliquant son nom (zone non interactive de la
// ligne → onRowClick) et renvoie le locator de la popup.
async function ouvrirPopup(page: Page, nom: string) {
  await ligne(page, nom).getByText(nom).click()
  const popup = page.getByRole('alertdialog')
  await expect(popup.getByRole('heading', { name: new RegExp(nom) })).toBeVisible()
  return popup
}

test.describe('Admin — demandes & paiements', () => {
  // ——— ADM-01 — Liste + filtres ———
  test('ADM-01 — la liste affiche les demandes et les filtres restreignent', async ({ page }) => {
    await page.goto('/admin/demandes')
    await expect(page).toHaveURL(/\/admin\/demandes/)

    // La liste contient les demandes de démo (lignes présentes).
    await expect(ligne(page, DEMO.enAttente.name)).toBeVisible() // Camille Bertrand
    await expect(ligne(page, DEMO.payeeSoldee.name)).toBeVisible() // Julien Moreau
    await expect(ligne(page, DEMO.placee.name)).toBeVisible() // Famille Dupuis

    // Locators des filtres (label englobant → select interne). On évite
    // getByLabel pour ces <select> car le nom accessible peut inclure le texte
    // des <option>.
    // TODO sélecteur fragile : repose sur le texte du <label> englobant.
    const filtreStatut = page.locator('label').filter({ hasText: 'Statut' }).locator('select')
    const recherche = page.getByPlaceholder('Nom, email ou téléphone')

    // Filtre par STATUT « Placées » : seule la demande placée (Famille Dupuis)
    // reste — indépendant du paiement, donc stable. Live (debounce 250 ms +
    // router.replace) → on attend l'URL puis l'état de la liste.
    await filtreStatut.selectOption({ label: 'Placées' })
    await expect(page).toHaveURL(/statut=placed/)
    await expect(ligne(page, DEMO.placee.name)).toBeVisible()
    await expect(ligne(page, DEMO.enAttente.name)).toHaveCount(0)
    await expect(ligne(page, DEMO.payeeSoldee.name)).toHaveCount(0)

    await page.getByRole('button', { name: 'Réinitialiser' }).click()
    await expect(page).toHaveURL(/\/admin\/demandes$/)

    // Filtre par RECHERCHE « Bertrand » : ne laisse que Camille Bertrand.
    await recherche.fill('Bertrand')
    await expect(page).toHaveURL(/[?&]q=Bertrand/)
    await expect(ligne(page, DEMO.enAttente.name)).toBeVisible()
    await expect(ligne(page, DEMO.payeeSoldee.name)).toHaveCount(0)
  })

  // ——— ADM-02 — Versement espèces = reste dû → SOLDÉ ———
  test('ADM-02 — ajouter un versement espèces solde la demande de Camille', async ({ page }) => {
    await page.goto('/admin/demandes')
    const popup = await ouvrirPopup(page, DEMO.enAttente.name)

    // Camille = 4 places adultes × 12 € = 48 € dû, non payée.
    // Champs de la popup « Ajouter un versement » (libellés EXACTS du markup) :
    //  - <select aria-label="Mode de règlement"> (défaut « Chèque »)
    //  - <input  aria-label="Montant du versement en euros"> (pré-rempli au reste dû)
    //  - <input  aria-label="Date de paiement"> (pré-rempli au jour)
    //  - <button>Ajouter le versement</button>
    const montant = popup.getByLabel('Montant du versement en euros')

    // À la date du seed, Camille est expirée → le formulaire n'apparaît qu'après
    // « Prolonger (+14 j) ». Conditionnel : robuste si elle ne l'est pas.
    if (!(await montant.isVisible())) {
      await popup.getByRole('button', { name: 'Prolonger' }).click()
      await expect(montant).toBeVisible() // attend la revalidation de la popup
    }

    // Récap cohérent AVANT : reste dû = 48 €, montant pré-rempli au reste.
    await expect(popup.getByText('reste 48,00 €')).toBeVisible()
    await expect(montant).toHaveValue('48,00')

    // Versement ESPÈCES du reste dû (on laisse le montant pré-rempli = 48,00).
    await popup.getByLabel('Mode de règlement').selectOption('especes')
    await popup.getByRole('button', { name: 'Ajouter le versement' }).click()

    // APRÈS revalidation : la popup montre « soldé ✓ » (état persistant).
    await expect(popup.getByText('soldé ✓')).toBeVisible()

    // La ligne reflète le solde (chip) et le passage en statut payé (« À placer »).
    await popup.getByRole('button', { name: 'Fermer' }).click()
    await expect(ligne(page, DEMO.enAttente.name).getByText('✓ Soldé')).toBeVisible()
    await expect(ligne(page, DEMO.enAttente.name).getByText('À placer')).toBeVisible()
  })

  // ——— ADM-03 — Acompte puis solde (deux versements) ———
  test('ADM-03 — versement partiel (acompte) puis solde sur Élodie', async ({ page }) => {
    // Élodie (DEMO.payeeAcompte) : 6 places, 1 offerte → 5 payantes × 12 = 60 €
    // dû, déjà 30 € réglés → ACOMPTE. On ajoute un versement partiel (reste en
    // acompte) puis le solde. Demande payée donc jamais expirée : pas de
    // prolongation à prévoir.
    await page.goto('/admin/demandes')
    await expect(ligne(page, DEMO.payeeAcompte.name).getByText('⏳ Acompte')).toBeVisible()

    const popup = await ouvrirPopup(page, DEMO.payeeAcompte.name)
    const montant = popup.getByLabel('Montant du versement en euros')

    // État initial : reste 30 €, montant pré-rempli au reste.
    await expect(popup.getByText('reste 30,00 €')).toBeVisible()
    await expect(montant).toHaveValue('30,00')

    // 1ᵉʳ versement PARTIEL de 10 € → net 40 € < 60 € → reste acompte.
    await popup.getByLabel('Mode de règlement').selectOption('especes')
    await montant.fill('10')
    await popup.getByRole('button', { name: 'Ajouter le versement' }).click()

    // Toujours en acompte ; le formulaire remonte avec le nouveau reste pré-rempli.
    await expect(popup.getByText('reste 20,00 €')).toBeVisible()
    await expect(montant).toHaveValue('20,00') // gate : form remonté (key = nb versements)

    // 2ᵉ versement = reste (20 €) → net 60 € = dû → SOLDÉ.
    await popup.getByLabel('Mode de règlement').selectOption('especes')
    await popup.getByRole('button', { name: 'Ajouter le versement' }).click()

    await expect(popup.getByText('soldé ✓')).toBeVisible()
    await popup.getByRole('button', { name: 'Fermer' }).click()
    await expect(ligne(page, DEMO.payeeAcompte.name).getByText('✓ Soldé')).toBeVisible()
  })

  // ——— ADM-04 — Remboursement sur une demande payée ———
  test('ADM-04 — un remboursement marque la demande « Remboursé »', async ({ page }) => {
    // Julien (DEMO.payeeSoldee) : 2 places × 12 = 24 € dû, soldé espèces.
    // Le bloc « Remboursement » n'apparaît que si un montant a été reçu (c'est le
    // cas). Champs (libellés EXACTS) :
    //  - <input  aria-label="Montant remboursé en euros">
    //  - <select aria-label="Motif du remboursement"> (1ʳᵉ option « Place(s)
    //    retirée(s) » réclame un nombre → on choisit « Geste commercial »)
    //  - <button>Enregistrer le remboursement</button>
    await page.goto('/admin/demandes')
    const popup = await ouvrirPopup(page, DEMO.payeeSoldee.name)

    await popup.getByLabel('Montant remboursé en euros').fill('5')
    await popup.getByLabel('Motif du remboursement').selectOption({ label: 'Geste commercial' })
    await popup.getByRole('button', { name: 'Enregistrer le remboursement' }).click()

    // Feedback inline (ce formulaire n'est PAS remonté → message persistant) +
    // net recalculé (24 − 5 = 19 €) dans le bloc remboursement.
    await expect(popup.getByText('Remboursement enregistré.')).toBeVisible()
    await expect(popup.getByText(/net en caisse/)).toBeVisible()

    // La ligne porte désormais le chip « ↩ Remboursé ».
    await popup.getByRole('button', { name: 'Fermer' }).click()
    await expect(ligne(page, DEMO.payeeSoldee.name).getByText('↩ Remboursé')).toBeVisible()
  })

  // ——— ADM-06 — Création admin : doublon bloquant par email ———
  test('ADM-06 — créer une demande avec un email déjà utilisé est bloqué', async ({ page }) => {
    // On réutilise l'email de Julien (DEMO.payeeSoldee, statut « payé » donc
    // TOUJOURS actif) plutôt que celui de Camille : à la date du seed, Camille
    // est expirée → inactive → ne déclencherait pas le doublon. Julien rend ce
    // cas autonome. Le formulaire cible la 1ʳᵉ représentation ouverte (rep-samedi,
    // où vit la demande de Julien).
    await page.goto('/admin/demandes/nouvelle')

    await page.getByLabel('Prénom', { exact: true }).fill('Test')
    await page.getByLabel('Nom', { exact: true }).fill('Doublon')
    await page.getByLabel('Email', { exact: true }).fill(DEMO.payeeSoldee.email)
    await page.getByLabel('Téléphone').fill('0600000000')
    await page.getByRole('button', { name: 'Créer la demande' }).click()

    // Bloc bloquant + lien vers la demande existante ; aucune redirection.
    await expect(page.getByText('Une demande existe déjà pour cet email')).toBeVisible()
    const lienExistant = page.getByRole('link', { name: new RegExp(DEMO.payeeSoldee.name) })
    await expect(lienExistant).toHaveAttribute('href', /\/admin\/demandes\?q=julien\.moreau(%40|@)example\.com/)
    await expect(page).toHaveURL(/\/admin\/demandes\/nouvelle$/)
  })
})
