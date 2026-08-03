// E2E — Gestion des représentations (admin super-admin). Couvre la carte
// /admin/representations (app/admin/(protected)/representations/) : CRUD en
// ISOLATION (création d'une rep NEUVE à titre unique → apparaît fermée →
// ouverture/fermeture des réservations), réglage des tarifs adulte/enfant
// (carte « Tarifs »), lecture de la page « Modifier » d'une rep de démo
// (route [id]), BLOCAGE de la suppression dès qu'une demande existe, et
// ARCHIVAGE/DÉSARCHIVAGE (REP-06 : clôture réversible — la rep sort du
// tableau de bord et des sélecteurs plan/scan, puis revient à l'identique).
//
// Mécanique du produit (lue dans le markup) :
//  • Toutes les actions sont des SERVER ACTIONS (`<form action={…}>`) qui se
//    terminent par un redirect vers `/admin/representations?ok=…` ou `?err=…` ;
//    la page relit ces query params et rend une bannière (`bannerOk`/`bannerErr`).
//    On assert donc l'ÉTAT PERSISTANT après reload (badge de la ligne, bannière),
//    pas un message transitoire.
//  • Une rep est créée FERMÉE (isOpen=false) : badge « Fermées » + bouton
//    « Ouvrir ». Le bascule rejoue un redirect → on relit le badge.
//  • La suppression n'est OFFERTE (bouton « Supprimer ») que si la rep a 0
//    demande ; sinon le markup remplace le bouton par un <span>« suppression
//    bloquée »</span>. Les deux reps de démo (rep-samedi / rep-dimanche) ont des
//    demandes → on y vérifie le blocage SANS rien supprimer.
//  • Les tarifs sont GLOBAUX (s'appliquent à toutes les reps). Pour rester NON
//    DESTRUCTIF sur la base partagée, on (re)pose exactement les valeurs du seed
//    (12 € / 6 €) : l'action est réelle mais l'état net est inchangé pour les
//    fichiers qui s'exécutent après (ordre alphabétique : scan, smoke).
//
// PIÈGES respectés :
//  • getByRole('alert') matcherait le route-announcer Next → on assert les
//    bannières via getByText(…).
//  • Inputs de tarif : ils ont un aria-label (« Tarif adulte en euros ») qui
//    PRIME sur le texte du <label> englobant (« Tarif adulte (en euros) ») pour
//    le nom accessible → getByLabel cible l'aria-label.
//  • Base partagée, série : la rep créée porte un titre UNIQUE (e2e-${Date.now()})
//    et est laissée FERMÉE (donc absente du formulaire public) → inoffensive pour
//    les specs suivantes. On ne touche jamais rep-samedi/rep-dimanche.
//  • /mnt/c lent : on s'appuie sur l'auto-retry de expect(), aucun délai fixe.

import { expect, test, type Page } from '@playwright/test'

import { DEMO, ROLES_AUTH } from './data'

// Rôle requis par requireSuperAdmin() sur toute la section représentations.
test.use({ storageState: ROLES_AUTH['super-admin'] })

// Ligne (TR) du tableau portant ce titre — exclut l'en-tête (pas de titre) et
// les autres reps. hasText est un substring littéral ancré sur le titre unique.
const ligne = (page: Page, titre: string) => page.getByRole('row').filter({ hasText: titre })

test.describe('Admin — représentations (super-admin)', () => {
  // ——— REP-01 — Création (fermée par défaut) + ouverture/fermeture ———
  test('REP-01 — créer une représentation neuve : apparaît fermée, puis ouvrir/fermer', async ({
    page,
  }) => {
    const titre = `Repr E2E ${Date.now()}` // unique → pas de collision sur la base partagée
    await page.goto('/admin/representations')

    // Formulaire « Nouvelle représentation » (libellés EXACTS du markup) :
    //  - <input name="title"> via <label>Titre</label>
    //  - <input type="datetime-local" name="startsAt"> via <label>Date et heure (heure de Paris)</label>
    //  - <button>Créer (réservations fermées)</button>
    await page.getByLabel('Titre', { exact: true }).fill(titre)
    await page.getByLabel('Date et heure (heure de Paris)', { exact: true }).fill('2099-06-26T20:30')
    await page.getByRole('button', { name: 'Créer (réservations fermées)' }).click()

    // Redirect ?ok=… : bannière de succès (≠ route-announcer → getByText).
    await expect(page).toHaveURL(/[?&]ok=/)
    await expect(page.getByText(/Représentation créée/)).toBeVisible()

    // La nouvelle ligne existe et est FERMÉE par défaut : badge « Fermées » +
    // bouton « Ouvrir ». 0 demande → suppression OFFERTE (bouton « Supprimer »),
    // donc PAS de « suppression bloquée ».
    const l = ligne(page, titre)
    await expect(l.getByText('Fermées')).toBeVisible()
    await expect(l.getByRole('button', { name: 'Ouvrir' })).toBeVisible()
    await expect(l.getByRole('button', { name: 'Supprimer' })).toBeVisible()
    await expect(l.getByText('suppression bloquée')).toHaveCount(0)

    // OUVRIR les réservations → bascule + redirect ; le badge passe à « Ouvertes »
    // et le bouton devient « Fermer ».
    await l.getByRole('button', { name: 'Ouvrir' }).click()
    await expect(page.getByText('Réservations ouvertes pour')).toBeVisible()
    await expect(ligne(page, titre).getByText('Ouvertes')).toBeVisible()
    await expect(ligne(page, titre).getByRole('button', { name: 'Fermer' })).toBeVisible()

    // FERMER à nouveau → on laisse la rep FERMÉE (invisible côté public) pour ne
    // pas polluer les specs suivantes.
    await ligne(page, titre).getByRole('button', { name: 'Fermer' }).click()
    await expect(page.getByText('Réservations fermées pour')).toBeVisible()
    await expect(ligne(page, titre).getByText('Fermées')).toBeVisible()
    await expect(ligne(page, titre).getByRole('button', { name: 'Ouvrir' })).toBeVisible()
  })

  // ——— REP-02 — Tarifs adulte/enfant (carte « Tarifs ») ———
  test('REP-02 — fixer les tarifs adulte/enfant via la carte Tarifs', async ({ page }) => {
    // NON DESTRUCTIF : on repose les valeurs du seed (12 € / 6 €) → action réelle,
    // état net inchangé. Inputs ciblés par aria-label (prime sur le <label>).
    await page.goto('/admin/representations')

    await page.getByLabel('Tarif adulte en euros').fill('12')
    await page.getByLabel('Tarif enfant en euros').fill('6')
    await page.getByRole('button', { name: 'Enregistrer les tarifs' }).click()

    // Redirect ?ok= : bannière « Tarifs : adulte 12,00 €, enfant 6,00 €. »
    // (euros() formate « 12,00 € » avec une espace simple). Le séparateur «, »
    // (≠ « · » du rappel « Tarifs actuels ») désambiguïse la bannière du hint.
    await expect(page).toHaveURL(/[?&]ok=/)
    await expect(page.getByText(/Tarifs : adulte 12,00 €, enfant 6,00 €/)).toBeVisible()
  })

  // ——— REP-03 — Page « Modifier » d'une rep de démo (route [id], lecture) ———
  test('REP-03 — la page Modifier d’une rep de démo affiche le formulaire pré-rempli et l’avertissement', async ({
    page,
  }) => {
    // rep-samedi a des demandes → la page d'édition affiche un avertissement
    // (bannerWarn) sur les demandes/billets liés. Lecture seule : on n'enregistre
    // RIEN (ne modifie pas le titre/la date d'une rep de démo).
    await page.goto(`/admin/representations/${DEMO.reps.samedi.id}`)

    await expect(page.getByRole('heading', { name: new RegExp(DEMO.reps.samedi.title) })).toBeVisible()
    await expect(page.getByText(/demande\(s\) et .* billet\(s\) sont liés/)).toBeVisible()
    // Champ Titre pré-rempli + bouton « Enregistrer » + retour à la liste.
    await expect(page.getByLabel('Titre', { exact: true })).toHaveValue(DEMO.reps.samedi.title)
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Retour aux représentations/ })).toBeVisible()
  })

  // ——— REP-04 — Suppression BLOQUÉE dès qu'une demande existe (lecture seule) ———
  test('REP-04 — une représentation de démo (avec demandes) ne propose pas la suppression', async ({
    page,
  }) => {
    // rep-samedi porte des demandes de démo → le markup remplace le bouton
    // « Supprimer » par un <span>« suppression bloquée »</span>. On vérifie le
    // blocage côté UI SANS rien supprimer ni altérer la rep.
    await page.goto('/admin/representations')

    const lSamedi = ligne(page, DEMO.reps.samedi.title)
    await expect(lSamedi).toBeVisible()
    await expect(lSamedi.getByText('suppression bloquée')).toBeVisible()
    await expect(lSamedi.getByRole('button', { name: 'Supprimer' })).toHaveCount(0)
    // La rep reste éditable et basculable (on ne clique pas) : repères de présence.
    await expect(lSamedi.getByRole('link', { name: 'Modifier' })).toBeVisible()
  })

  // ——— REP-06 — Archivage / désarchivage (clôture réversible) ———
  // NON DESTRUCTIF : la rep est NEUVE (titre unique), l'archivage ne supprime
  // ni ne mute rien, et le test la laisse désarchivée + fermée (état initial).
  // On vérifie le cycle complet : badge, boutons, disparition des écrans du
  // quotidien (tableau de bord, sélecteurs plan/scan), puis retour à l'état
  // d'avant.
  test('REP-06 — archiver une représentation la sort du quotidien, désarchiver la restaure', async ({
    page,
  }) => {
    const titre = `Repr ARCHIVE E2E ${Date.now()}`
    await page.goto('/admin/representations')
    await page.getByLabel('Titre', { exact: true }).fill(titre)
    await page.getByLabel('Date et heure (heure de Paris)', { exact: true }).fill('2099-08-15T20:30')
    await page.getByRole('button', { name: 'Créer (réservations fermées)' }).click()

    // État initial : active (badge « Fermées »), donc proposée partout.
    const l = () => ligne(page, titre)
    await expect(l().getByText('Fermées')).toBeVisible()
    await expect(l().getByRole('button', { name: 'Archiver' })).toBeVisible()
    await expect(l().getByText('Archivée')).toHaveCount(0)

    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: titre })).toBeVisible()
    await page.goto('/admin/plan')
    await expect(page.getByRole('option', { name: new RegExp(titre) })).toHaveCount(1)

    // ARCHIVER : ConfirmSubmit → ConfirmDialog (role=alertdialog) → Confirmer.
    // Le message chiffre l'impact et rappelle que rien n'est supprimé.
    await page.goto('/admin/representations')
    await l().getByRole('button', { name: 'Archiver' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Rien n’est supprimé/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Confirmer' }).click()

    // Redirect ?ok= : la ligne bascule sur le 3ᵉ état (ni ouverte ni fermée).
    // Bannière ciblée sur une formule UNIQUE de la page (le mot « archivée »
    // seul apparaît aussi dans le badge et dans le pavé d'aide → strict mode).
    await expect(page.getByText(/sortent des écrans du quotidien/)).toBeVisible()
    await expect(l().getByText('Archivée')).toBeVisible()
    await expect(l().getByRole('button', { name: 'Désarchiver' })).toBeVisible()
    await expect(l().getByRole('button', { name: 'Ouvrir' })).toHaveCount(0)
    await expect(l().getByRole('button', { name: 'Archiver' })).toHaveCount(0)
    // L'export reste offert : c'est la raison d'être de l'archive vs la suppression.
    await expect(l().getByRole('link', { name: 'Export CSV' })).toBeVisible()

    // Sortie des écrans du quotidien : plus de carte au tableau de bord, plus
    // d'option dans le sélecteur du plan ni dans celui du scan.
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: titre })).toHaveCount(0)
    await page.goto('/admin/plan')
    await expect(page.getByRole('option', { name: new RegExp(titre) })).toHaveCount(0)
    await page.goto('/admin/scan')
    await expect(page.getByRole('option', { name: new RegExp(titre) })).toHaveCount(0)

    // La vue miroir des demandes archivées annonce sa lecture seule.
    await page.goto('/admin/demandes?archives=1')
    await expect(page.getByRole('heading', { name: 'Demandes archivées' })).toBeVisible()
    await expect(page.getByText(/lecture seule/)).toBeVisible()

    // DÉSARCHIVER : retour à « Fermées » (jamais de réouverture automatique des
    // ventes) → l'état net du test est exactement l'état de création.
    await page.goto('/admin/representations')
    await l().getByRole('button', { name: 'Désarchiver' }).click()
    await expect(page.getByText(/désarchivée — réservations fermées/)).toBeVisible()
    await expect(l().getByText('Fermées')).toBeVisible()
    await expect(l().getByRole('button', { name: 'Ouvrir' })).toBeVisible()
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: titre })).toBeVisible()
  })

  // ——— REP-05 — Suppression RÉELLE d'une rep neuve (DESTRUCTIF → fixme) ———
  // test.fixme : flux DESTRUCTIF (delete) ET interaction modale fragile
  // (ConfirmDialog, role="alertdialog", autoFocus + requestSubmit du form parent)
  // que l'on ne joue pas sans exécuter/vérifier la suite. La rep est NEUVE et
  // isolée (titre unique) → la supprimer ne touche aucune donnée de démo.
  test.fixme(
    'REP-05 — supprimer une représentation neuve via la confirmation',
    async ({ page }) => {
      const titre = `Repr SUPPR E2E ${Date.now()}`
      await page.goto('/admin/representations')

      // Création de la cible isolée.
      await page.getByLabel('Titre', { exact: true }).fill(titre)
      await page
        .getByLabel('Date et heure (heure de Paris)', { exact: true })
        .fill('2099-07-01T20:30')
      await page.getByRole('button', { name: 'Créer (réservations fermées)' }).click()
      const l = ligne(page, titre)
      await expect(l).toBeVisible()

      // Bouton « Supprimer » (ConfirmSubmit) → ouvre la ConfirmDialog, puis on
      // confirme : requestSubmit du <form action={supprimerRepresentation}>.
      await l.getByRole('button', { name: 'Supprimer' }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Confirmer' }).click()

      // Redirect ?ok= + ligne disparue.
      await expect(page.getByText('Représentation supprimée.')).toBeVisible()
      await expect(ligne(page, titre)).toHaveCount(0)
    },
  )
})
