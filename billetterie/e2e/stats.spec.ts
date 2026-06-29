// E2E — /admin/stats (statistiques billetterie). LECTURE SEULE : la page agrège
// tout à la volée (aucune table dédiée) → on vérifie le RENDU et la COHÉRENCE,
// jamais des pixels, et on NE mute PAS la base de démo partagée.
//
// Ordre d'exécution (alphabétique, série, base partagée) : ce fichier passe
// APRÈS demandes-paiement.spec.ts et public.spec.ts. Donc, en suite complète,
// la caisse reflète déjà des mutations (Camille soldée, Élodie soldée, Julien
// remboursé de 5 €, une demande publique créée). Les MONTANTS exacts dépendent
// donc du contexte (suite complète vs fichier isolé sur base fraîche) → on NE
// fige AUCUN euro. On vérifie l'INVARIANT produit « net = Σ versements −
// remboursé » (lib/admin/money.ts), vrai dans les DEUX contextes.
//
// Markup ciblé (lu dans app/admin/(protected)/stats/) :
//  • page.tsx       — vue d'ensemble (<section> + <table> compareTable) puis un
//                     <details> repliable par représentation (plié par défaut).
//  • charts.tsx     — BarChart / Jauge = <div role="img" aria-label="Label :
//                     montant, …"> (PAS de <svg>) ; euros() = « 24,00 € » sans
//                     séparateur de milliers → parsable par un motif simple.
//  • line-chart.tsx — courbe « Demandes dans le temps » = <svg role="img">.
//
// Pièges respectés : on cible par rôle/texte ancré (jamais getByRole('term')
// /'definition'), un <details> plié sort son contenu de l'arbre a11y (toBeHidden
// / toBeVisible togglent proprement), et on s'appuie sur l'auto-retry d'expect()
// (/mnt/c lent) plutôt que sur des délais fixes.

import { expect, test, type Page } from '@playwright/test'

import { DEMO, ROLES_AUTH } from './data'

// Parcours admin (requireAdmin rejette le rôle scan). Session forgée au setup.
test.use({ storageState: ROLES_AUTH.admin })

// « 24,00 € » / « 1800,00 € » → centimes. euros() (lib/admin/money.ts) fait
// toFixed(2) puis '.'→',' SANS séparateur de milliers : le motif `\d+,\d{2}`
// suffit. Somme TOUTES les occurrences — l'aria-label de la caisse en liste
// plusieurs (« Espèces : 24,00 €, Chèques : 78,00 € »).
function eurosVersCentimes(texte: string): number {
  let total = 0
  for (const m of texte.matchAll(/(\d+),(\d{2})/g)) {
    total += Number(m[1]) * 100 + Number(m[2])
  }
  return total
}

// <details> du bloc d'une représentation (replié par défaut), ciblé par son
// titre (DEMO.reps.*.title). La vue d'ensemble est une <section>, pas un
// <details> → jamais capturée ici.
const blocRep = (page: Page, titre: string) => page.locator('details').filter({ hasText: titre })

test.describe('Admin — statistiques (/admin/stats)', () => {
  test('STAT-01 — la page charge (titre + URL)', async ({ page }) => {
    await page.goto('/admin/stats')
    await expect(page).toHaveURL(/\/admin\/stats$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Statistiques' })).toBeVisible()
  })

  test('STAT-02 — vue d’ensemble : tableau de comparaison par année', async ({ page }) => {
    await page.goto('/admin/stats')
    await expect(page.getByRole('heading', { name: /comparaison par année/ })).toBeVisible()

    // Les 10 colonnes du compareTable (libellés EXACTS du thead). exact:true pour
    // que « Billets » ne capture pas « Recette billets ».
    const colonnes = [
      'Année',
      'Soirées',
      'Billets',
      'Remplissage',
      'Demandes',
      'Adultes',
      'Enfants',
      'Recette billets',
      'Recette buvette',
      'Balance buvette',
    ]
    await expect(page.getByRole('columnheader')).toHaveCount(colonnes.length)
    for (const nom of colonnes) {
      await expect(page.getByRole('columnheader', { name: nom, exact: true })).toBeVisible()
    }

    // Les deux représentations de démo sont en 2026 → une ligne « 2026 » (cellule
    // <strong>2026</strong>). Réps jamais supprimées par les autres specs → stable.
    await expect(page.getByRole('cell', { name: '2026', exact: true })).toBeVisible()
  })

  test('STAT-03 — vue d’ensemble : trois graphes par année (présence)', async ({ page }) => {
    await page.goto('/admin/stats')
    const overview = page.locator('section').filter({ hasText: /comparaison par année/ })

    for (const titre of [
      /Billets émis par année/,
      /Recette billetterie par année/,
      /Recette buvette par année/,
    ]) {
      await expect(overview.getByRole('heading', { name: titre })).toBeVisible()
    }

    // 3 BarChart = 3 <div role="img"> (présence, pas pixels). La section
    // d'ensemble n'a pas de Jauge ni de <svg> → compte stable.
    await expect(overview.getByRole('img')).toHaveCount(3)
  })

  test('STAT-04 — les blocs par représentation sont repliés par défaut puis dépliables', async ({
    page,
  }) => {
    await page.goto('/admin/stats')
    await expect(page.getByRole('heading', { name: /Détail par repr/ })).toBeVisible()

    const bloc = blocRep(page, DEMO.reps.samedi.title)
    const sommaire = bloc.locator('summary')
    await expect(sommaire).toBeVisible()
    await expect(sommaire).toContainText('billets') // résumé « X/Y billets · Z % »

    // Plié par défaut : le contenu (h3 « Remplissage ») est hors de l'arbre a11y
    // → toBeHidden (un <details> fermé masque tout sauf son <summary>).
    const remplissage = bloc.getByRole('heading', { name: 'Remplissage' })
    await expect(remplissage).toBeHidden()

    // Déplier au clic sur le sommaire → contenu visible.
    await sommaire.click()
    await expect(remplissage).toBeVisible()

    // Replier → contenu de nouveau masqué (le <details> est bien interactif).
    await sommaire.click()
    await expect(remplissage).toBeHidden()
  })

  test('STAT-05 — un bloc déplié affiche ses cartes et ses graphes (jauge + courbe)', async ({
    page,
  }) => {
    await page.goto('/admin/stats')
    const bloc = blocRep(page, DEMO.reps.samedi.title)
    await bloc.locator('summary').click()

    // Cartes attendues (h3). exact:true pour distinguer « Demandes » de
    // « Demandes dans le temps ».
    for (const h of ['Remplissage', 'Demandes', 'Caisse']) {
      await expect(bloc.getByRole('heading', { name: h, exact: true })).toBeVisible()
    }

    // Jauge de remplissage : <div role="img" aria-label="… (NN %)"> (charts.tsx).
    // Plusieurs jauges possibles (remplissage + entrées scannées) → .first().
    await expect(bloc.getByRole('img', { name: /%/ }).first()).toBeVisible()

    // Courbe « Demandes dans le temps » : <svg> inline (line-chart.tsx). rep-samedi
    // a des demandes actives → la courbe est rendue. Présence, pas pixels.
    await expect(bloc.locator('svg').first()).toBeVisible()
  })

  test('STAT-06 — réconciliation de caisse : net = Σ versements − remboursé', async ({ page }) => {
    await page.goto('/admin/stats')
    const bloc = blocRep(page, DEMO.reps.samedi.title)
    await bloc.locator('summary').click()
    await expect(bloc.getByRole('heading', { name: 'Caisse', exact: true })).toBeVisible()

    // BarChart de la caisse : aria-label « Espèces : 24,00 €, Chèques : 78,00 € »
    // (charts.tsx). Σ des montants = total REÇU, tous modes confondus. On le
    // distingue des autres role="img" du bloc par les libellés de modes.
    const graphe = bloc.getByRole('img', { name: /Espèces|Chèques/ })
    await expect(graphe).toBeVisible()
    const recuCents = eurosVersCentimes((await graphe.getAttribute('aria-label')) ?? '')
    expect(recuCents).toBeGreaterThan(0) // rep-samedi a toujours des versements

    // Ligne « Remboursé » présente UNIQUEMENT si > 0 (Julien remboursé par
    // demandes-paiement en suite complète ; absente sur base fraîche). Robuste
    // aux deux contextes.
    const ligneRemb = bloc.getByText(/Remboursé/)
    const rembCents =
      (await ligneRemb.count()) > 0
        ? eurosVersCentimes((await ligneRemb.first().textContent()) ?? '')
        : 0

    // « Total net : … € » (styles.totalCaisse).
    const netCents = eurosVersCentimes((await bloc.getByText(/Total net/).textContent()) ?? '')

    // Invariant produit (lib/admin/money.ts) : net = reçu − remboursé. Vrai quel
    // que soit l'état de mutation de la base partagée.
    expect(netCents).toBe(recuCents - rembCents)
  })

  // ——— SEC — garde d'accès (session retirée pour ce bloc uniquement) ———
  test.describe('SEC — garde d’accès', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('STAT-SEC — /admin/stats sans session redirige vers /admin/login', async ({ page }) => {
      await page.goto('/admin/stats')
      await expect(page).toHaveURL(/\/admin\/login/)
    })
  })

  // ——— Interactions DESTRUCTIVES (mutent la démo partagée) — NON exécutées ———
  // Le « bilan d'organisation » écrit sur la représentation et la buvette de
  // rep-samedi (météo, notes, articles), ce qui persiste pour les fichiers
  // suivants et casse l'idempotence de la démo. Laissées en test.fixme : à
  // n'activer que sur une représentation NEUVE isolée. Les sélecteurs sont
  // déjà ancrés sur le markup réel (aria-labels de page.tsx) pour une
  // réactivation directe.

  test.fixme(
    'STAT-07 — ajouter un article buvette (DESTRUCTIF : crée un BuvetteItem)',
    async ({ page }) => {
      await page.goto('/admin/stats')
      const bloc = blocRep(page, DEMO.reps.samedi.title)
      await bloc.locator('summary').click()

      // Le formulaire d'ajout se distingue des lignes existantes (mêmes aria-labels)
      // par son champ unique « Nouvel article » → on scope dessus.
      const ajout = bloc.locator('form').filter({ has: page.getByLabel('Nouvel article') })
      await ajout.getByLabel('Nouvel article').fill('E2E test')
      await ajout.getByLabel('Quantité achetée').fill('10')
      await ajout.getByLabel("Prix d'achat en euros").fill('1')
      await ajout.getByLabel('Quantité vendue').fill('5')
      await ajout.getByLabel('Prix de vente en euros').fill('2')
      await ajout.getByRole('button', { name: '+ Ajouter' }).click()

      await expect(bloc.getByText('E2E test')).toBeVisible()
    },
  )

  test.fixme(
    'STAT-08 — enregistrer météo & notes (DESTRUCTIF : écrit sur la représentation)',
    async ({ page }) => {
      await page.goto('/admin/stats')
      const bloc = blocRep(page, DEMO.reps.samedi.title)
      await bloc.locator('summary').click()

      // Météo du soir : selects « Ciel — <moment> » + « Température — <moment> »
      // (page.tsx, MOMENTS = Début de soirée / Milieu / Fin).
      await bloc.getByLabel(/Ciel —/).first().selectOption({ label: '☀️ Soleil' })
      await bloc.getByLabel(/Température —/).first().fill('22')
      await bloc.getByRole('button', { name: /Enregistrer météo/ }).click()
    },
  )
})
