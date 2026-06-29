// E2E — /admin/comptes : gestion des accès (SUPER-ADMIN uniquement).
// Composants : app/admin/(protected)/comptes/page.tsx + actions.ts.
//
// Couvre : (CPT-01) lecture de la liste des super-admins « garantis » (.env) avec
// le marqueur « (vous) » ; (CPT-02) cycle de vie d'un compte géré — création
// (email UNIQUE e2e-…@test.local) → présence dans la liste → changement de rôle
// admin→super-admin → suppression (nettoyage) ; (CPT-03) PIN du mode scan : on le
// DÉFINIT puis on le DÉSACTIVE (restaure l'état du seed = aucun PIN) ; (CPT-04)
// refus de créer un compte géré pour une adresse ADMIN_EMAILS ; (CPT-06) garde :
// un rôle « admin » ne peut pas accéder à /admin/comptes.
//
// SOCLE (non modifié) : e2e/data.ts (ROLES_AUTH) + global-setup (sessions forgées)
// + playwright.config.ts (série workers:1, baseURL, ADMIN_EMAILS de test =
// « admin@test.local,superadmin@test.local », base seedée fraîche). La session
// super-admin forgée a pour email superadmin@test.local → c'est elle qui porte
// « (vous) » dans la table .env.
//
// NON DESTRUCTIF (règle d'or) : on ne touche ni aux reps/bookings de démo ni aux
// super-admins .env. Tout ce qu'on mute est ISOLÉ et NETTOYÉ dans le même test :
//  - le compte créé porte un email unique (e2e-${Date.now()}) et est supprimé ;
//  - le PIN scan (table Setting, absente du seed) est posé puis retiré.
// Le seed ne crée aucun compte géré ni PIN ; ce fichier passe d'ailleurs EN
// PREMIER (ordre alphabétique) → il part d'un état vierge sur ces deux tables.
//
// PIÈGES intégrés :
//  - getByRole('alert') matcherait le route-announcer Next → on lit les bandeaux
//    ok/err (de simples <p>) et les statuts via getByText.
//  - le <select> « Rôle » du formulaire de création a un <label> englobant + des
//    <option> longs : son nom accessible capte le texte des options → on le cible
//    par structure (label → select), pas par getByLabel.
//  - ConfirmSubmit est un composant CLIENT (le clic n'ouvre la boîte qu'une fois
//    hydraté). Sur le montage lent /mnt/c, le 1er clic peut précéder l'hydratation
//    → ouvrirConfirmation() RÉESSAYE le clic jusqu'à l'apparition de l'alertdialog.

import { expect, test, type Locator, type Page } from '@playwright/test'

import { ROLES_AUTH } from './data'

// Parcours principal : super-admin (seul rôle autorisé sur /admin/comptes).
test.use({ storageState: ROLES_AUTH['super-admin'] })

const PIN_TEST = '482913' // 6 chiffres → conforme au pattern \d{4,8}

// Ligne (TR) contenant ce texte — exclut bandeaux/sections (qui ne sont pas des
// rows). NB : « superadmin@test.local » CONTIENT « admin@test.local » → pour
// cibler la ligne .env « admin@test.local » sans ambiguïté il faudrait un regex
// ancré ; ici on ne vise que des emails non ambigus (superadmin, ou e2e-…@…).
const ligne = (page: Page, texte: string) => page.getByRole('row').filter({ hasText: texte })

// Clique un déclencheur ConfirmSubmit et renvoie la boîte de confirmation
// (role="alertdialog"). Robuste à l'hydratation tardive : on retente le clic tant
// que la boîte n'est pas visible (idempotent — re-cliquer ne fait que ré-ouvrir).
async function ouvrirConfirmation(trigger: Locator): Promise<Locator> {
  const dialog = trigger.page().getByRole('alertdialog')
  await expect(async () => {
    await trigger.click()
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  return dialog
}

test.describe('Comptes & accès (super-admin)', () => {
  // ——— CPT-01 — Lecture : super-admins .env + marqueur « (vous) » ———
  test('CPT-01 — liste les super-admins .env et marque la session courante « (vous) »', async ({
    page,
  }) => {
    await page.goto('/admin/comptes')
    await expect(page.getByRole('heading', { level: 1, name: /Comptes & accès/ })).toBeVisible()

    // Section .env (lecture seule) + sa ligne pour la session forgée.
    await expect(
      page.getByRole('heading', { name: 'Super-admins (configuration serveur)' }),
    ).toBeVisible()
    const moi = ligne(page, 'superadmin@test.local') // unique (≠ admin@test.local)
    await expect(moi).toBeVisible()
    await expect(moi).toContainText('(vous)')

    // Les blocs de gestion sont rendus.
    await expect(page.getByRole('heading', { name: 'Ajouter un compte' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Accès scan (PIN partagé)' })).toBeVisible()
  })

  // ——— CPT-02 — Cycle de vie d'un compte géré (création → rôle → suppression) ———
  test('CPT-02 — créer un compte, le voir dans la liste, changer son rôle, le supprimer', async ({
    page,
  }) => {
    const email = `e2e-${Date.now()}@test.local` // unique → pas de collision/doublon
    await page.goto('/admin/comptes')

    // — Création (rôle admin). Email : <input> labellé proprement (sans <option>).
    await page.getByLabel('Email', { exact: true }).fill(email)
    // TODO sélecteur fragile : repose sur le texte du <label> englobant « Rôle »
    // (getByLabel inutilisable ici — le nom accessible inclurait le texte des
    // <option> longs).
    await page.locator('label').filter({ hasText: 'Rôle' }).locator('select').selectOption('admin')
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

    // Bandeau de succès (<p>, PAS role=alert) + nouvelle ligne (rôle = admin).
    await expect(page.getByText(`Compte ${email} ajouté`)).toBeVisible()
    const row = ligne(page, email)
    await expect(row).toBeVisible()
    await expect(row.getByRole('combobox')).toHaveValue('admin')

    // — Changement de rôle admin → super-admin (form server action « Appliquer »).
    await row.getByRole('combobox').selectOption('super-admin')
    await row.getByRole('button', { name: 'Appliquer' }).click()
    await expect(page.getByText(`Rôle de ${email} : super-admin.`)).toBeVisible()
    // Après revalidation, le <select> de la ligne reflète le nouveau rôle.
    await expect(ligne(page, email).getByRole('combobox')).toHaveValue('super-admin')

    // — Suppression (nettoyage) via la boîte de confirmation.
    const dialog = await ouvrirConfirmation(
      ligne(page, email).getByRole('button', { name: 'Supprimer' }),
    )
    await expect(dialog).toContainText(email) // « Supprimer le compte <email> ? »
    await dialog.getByRole('button', { name: 'Confirmer' }).click()

    await expect(page.getByText(`Compte ${email} supprimé.`)).toBeVisible()
    await expect(ligne(page, email)).toHaveCount(0)
  })

  // ——— CPT-03 — PIN du mode scan : définir puis désactiver (restaure le seed) ———
  test('CPT-03 — définir le PIN du mode scan puis le désactiver', async ({ page }) => {
    await page.goto('/admin/comptes')

    // Le libellé du champ est dynamique (« PIN » ou « Nouveau PIN » selon l'état)
    // → regex tolérante aux deux. Sa valeur ne pollue pas le nom accessible (input).
    await page.getByLabel(/PIN \(4 à 8 chiffres\)/).fill(PIN_TEST)
    await page.getByRole('button', { name: 'Enregistrer le PIN' }).click()

    // Statut basculé : un PIN est configuré.
    await expect(page.getByText(/Un PIN est configuré/)).toBeVisible()

    // — Nettoyage : désactiver le PIN → retour à l'état du seed (aucun PIN).
    const dialog = await ouvrirConfirmation(page.getByRole('button', { name: /Désactiver/ }))
    await expect(dialog).toContainText('supprimer le PIN') // évite l'apostrophe (’ vs ')
    await dialog.getByRole('button', { name: 'Confirmer' }).click()

    await expect(page.getByText(/Aucun PIN/)).toBeVisible()
  })

  // ——— CPT-04 — Refus : créer un compte géré pour une adresse ADMIN_EMAILS ———
  test('CPT-04 — créer un compte pour une adresse ADMIN_EMAILS est refusé (non destructif)', async ({
    page,
  }) => {
    await page.goto('/admin/comptes')

    // admin@test.local est super-admin « garanti » (.env) : la création d'un
    // compte géré pour cette adresse est refusée (on ne double pas l'.env). Aucun
    // compte n'est créé → strictement non destructif.
    await page.getByLabel('Email', { exact: true }).fill('admin@test.local')
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

    await expect(page).toHaveURL(/[?&]err=/)
    await expect(
      page.getByText(
        'Cette adresse est déjà super-admin via la configuration serveur (ADMIN_EMAILS).',
      ),
    ).toBeVisible()
  })

  // ——— CPT-05 — Anti-lockout (NON ATTEIGNABLE via l'UI dans cet environnement) ———
  // actions.ts interdit à un super-admin de se rétrograder / se supprimer LUI-MÊME
  // quand son email n'est PAS dans ADMIN_EMAILS. Or ici la session forgée est
  // superadmin@test.local, COUVERTE par ADMIN_EMAILS → (a) elle n'a pas de ligne
  // dans « Comptes gérés ici » (la table .env est en lecture seule, sans action),
  // et (b) createAdminAccount refuse un compte géré pour une adresse .env (CPT-04).
  // La branche `email === session.email && !isAdminEmail` est donc inatteignable
  // par l'UI. À couvrir en test unitaire d'actions.ts, ou en E2E avec une session
  // forgée HORS ADMIN_EMAILS + un compte géré du même email.
  test.fixme(
    'CPT-05 — un super-admin ne peut pas retirer son propre accès (non atteignable en E2E)',
    async ({ page }) => {
      await page.goto('/admin/comptes')
      // const moi = ligne(page, '<email-de-session-hors-ADMIN_EMAILS>')
      // await moi.getByRole('combobox').selectOption('admin')
      // await moi.getByRole('button', { name: 'Appliquer' }).click()
      // await expect(
      //   page.getByText('Vous ne pouvez pas retirer votre propre accès super-admin.'),
      // ).toBeVisible()
    },
  )
})

// ——— Garde d'accès : le rôle « admin » n'a PAS accès à /admin/comptes ———
test.describe('Comptes — garde d’accès (rôle admin)', () => {
  test.use({ storageState: ROLES_AUTH.admin })

  test('CPT-06 — un admin (non super-admin) est redirigé hors de /admin/comptes', async ({
    page,
  }) => {
    await page.goto('/admin/comptes')
    // requireSuperAdmin → rôle insuffisant → redirige vers l'accueil du rôle (/admin),
    // jamais vers /admin/login (la personne EST connectée).
    await expect(page).not.toHaveURL(/\/admin\/comptes/)
    await expect(page).toHaveURL(/\/admin\/?$/)
  })
})
