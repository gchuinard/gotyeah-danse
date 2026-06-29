// SCAN — page de scan du soir (app/admin/(protected)/scan/scan-view.tsx).
//
// La CAMÉRA n'est pas pilotée en E2E : on couvre la logique par la RECHERCHE
// MANUELLE (select « Rechercher par » + champ de recherche + bouton « Marquer
// scanné »). Le manifeste de `rep-samedi` = les 4 billets de « Famille Dupuis »
// (rang R, le seul booking PLACÉ du seed) → compteur « 0 scannés / 4 billets ».
//
// ORDRE IMPORTANT (workers:1, base de test PARTAGÉE et mutée) : SCAN-02 marque
// un billet scanné PUIS attend la synchro serveur (POST /api/admin/scan) → cet
// état PERSISTE en base. SCAN-03 et SCAN-06 s'exécutent donc APRÈS et voient ce
// billet « déjà scanné ». Ne pas réordonner ces trois cas.
//
// LIMITE caméra (documentée) : les panneaux de DOUBLON — teal « Laissez entrer »
// (souple) et ambre « Déjà scanné » (strict) — ne se déclenchent QUE par un
// RE-SCAN, et la saisie manuelle masque le bouton « Marquer scanné » dès qu'un
// billet est scanné (elle affiche « Scanné à HH:MM »). Il n'existe donc aucun
// chemin manuel pour re-déclencher `processToken` sur un billet déjà scanné.
// → SCAN-03/04 couvrent la partie manuellement OBSERVABLE (état « Scanné à »,
//   non re-comptable ; bascule du mode strict). Les panneaux eux-mêmes sont
//   écrits en `test.fixme` (SCAN-03b / SCAN-04b), à câbler avec un faux flux
//   caméra (getUserMedia mocké réémettant un QR de DEMO.placee.qrTokens).

import { expect, test, type Page } from '@playwright/test'

import { DEMO, ROLES_AUTH } from './data'

// Auth : la page scan exige une session ; un admin y a accès.
test.use({ storageState: ROLES_AUTH.admin })

const SCAN_URL = `/admin/scan?rep=${DEMO.reps.samedi.id}`
// « Famille Dupuis » → nom de famille = tout sauf le 1ᵉʳ mot (« Famille »).
const NOM_DUPUIS = DEMO.placee.name.split(' ').slice(1).join(' ')

// Compteur « <n> scannés / <N> billets » : 1ʳᵉ région aria-live="polite" du
// markup (la 2ᵉ est l'indicateur de synchro). Attribut sémantique réel, stable.
const counter = (page: Page) => page.locator('[aria-live="polite"]').first()
// Panneau de résultat : unique région aria-live="assertive" de la page.
const panel = (page: Page) => page.locator('[aria-live="assertive"]')

// Attend que le manifeste soit chargé : « Chargement des billets… » et « Billets
// non chargés » ne contiennent pas « scannés » — seul l'état chargé l'affiche.
async function attendreManifeste(page: Page) {
  await expect(counter(page)).toContainText('scannés')
}

test.describe('SCAN — soir J (saisie manuelle, caméra non pilotée)', () => {
  test('SCAN-01 — chargement du manifeste : « 0 scannés / 4 billets »', async ({ page }) => {
    await page.goto(SCAN_URL)
    await attendreManifeste(page)
    // N = 4 : « Famille Dupuis » est le seul booking placé sur rep-samedi.
    await expect(counter(page)).toContainText('4 billets')
    // Ce cas s'exécute AVANT tout scan → 0 scannés, file de synchro à jour.
    await expect(counter(page)).toContainText('0 scannés')
    await expect(page.getByText('Synchro à jour')).toBeVisible()
  })

  test('SCAN-02 — recherche par nom → « Marquer scanné » → panneau vert + compteur +1', async ({
    page,
  }) => {
    await page.goto(SCAN_URL)
    await attendreManifeste(page)

    // Recherche par nom (critère par défaut) = « Dupuis » → les 4 sièges rang R.
    await page.getByRole('searchbox').fill(NOM_DUPUIS)
    const rows = page.getByRole('listitem')
    await expect(rows).toHaveCount(DEMO.placee.partySize) // 4
    await expect(rows.first()).toContainText(DEMO.placee.name)

    // On attend la confirmation serveur pour que l'état « scanné » PERSISTE en
    // base (SCAN-03 / SCAN-06 en dépendent). scan-data est en GET → le filtre
    // POST cible bien l'enregistrement du scan.
    const scanPosted = page.waitForResponse(
      (r) => r.url().includes('/api/admin/scan') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Marquer scanné' }).first().click()

    // Panneau vert (ok) : nom + place, SANS en-tête « déjà »/« Laissez entrer ».
    const p = panel(page)
    await expect(p.getByText(DEMO.placee.name)).toBeVisible()
    await expect(p).toContainText('Rang R')
    await expect(p).toContainText(/Place \d+/)
    await expect(p).not.toContainText('Laissez entrer')
    await expect(p).not.toContainText('Déjà')

    // Compteur +1 : SEUL un nouveau scan (panneau vert) l'incrémente — un doublon
    // ne le toucherait pas. C'est la preuve la plus forte du « scan ok ».
    await expect(counter(page)).toContainText('1 scannés')

    await scanPosted // garantit l'écriture en base avant les cas suivants
  })

  test('SCAN-03 — billet déjà scanné : « Scanné à HH:MM », non re-comptable (souple)', async ({
    page,
  }) => {
    await page.goto(SCAN_URL)
    // L'état de SCAN-02 a persisté : 1 billet déjà scanné en base.
    await expect(counter(page)).toContainText('1 scannés')

    await page.getByRole('searchbox').fill(NOM_DUPUIS)
    await expect(page.getByRole('listitem')).toHaveCount(DEMO.placee.partySize) // 4

    // Choix documenté (cf. en-tête) : en saisie manuelle, le billet déjà scanné
    // affiche « Scanné à HH:MM » et n'expose PLUS de bouton → impossible de le
    // re-scanner ici, donc pas de double comptage (comportement « souple »).
    await expect(page.getByText(/Scanné à \d{2}:\d{2}/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Marquer scanné' })).toHaveCount(
      DEMO.placee.partySize - 1, // 3 sièges restent à scanner
    )
    await expect(counter(page)).toContainText('1 scannés') // inchangé
  })

  // SCAN-03b — Le panneau SOUPLE (teal) « Laissez entrer » + « Déjà passé à HH:MM »
  // n'est atteignable que par un RE-SCAN caméra (voir LIMITE en en-tête).
  test.fixme(
    'SCAN-03b — panneau souple « Laissez entrer » au re-scan (caméra requise)',
    async ({ page }) => {
      await page.goto(SCAN_URL)
      await attendreManifeste(page)
      // … démarrer la caméra mockée et réémettre DEMO.placee.qrTokens[0] (déjà scanné) …
      const p = panel(page)
      await expect(p).toContainText('Laissez entrer')
      await expect(p).toContainText(/Déjà passé à \d{2}:\d{2}/)
      await expect(counter(page)).toContainText('1 scannés') // doublon → compteur inchangé
    },
  )

  test('SCAN-04 — Contrôle strict des doublons : la bascule active le mode alerte', async ({
    page,
  }) => {
    await page.goto(SCAN_URL)
    await attendreManifeste(page)

    const strict = page.getByRole('checkbox', { name: 'Contrôle strict des doublons' })
    await expect(strict).not.toBeChecked() // souple par défaut
    await strict.check()
    await expect(strict).toBeChecked()
    // L'indice bascule en mode alerte — précondition du panneau ambre (SCAN-04b).
    await expect(page.getByText('Un billet déjà scanné déclenche une alerte.')).toBeVisible()
  })

  // SCAN-04b — Le panneau STRICT (ambre) « Déjà scanné à HH:MM » n'est atteignable
  // que par un RE-SCAN caméra, le strict étant activé (voir LIMITE en en-tête).
  test.fixme(
    'SCAN-04b — panneau ambre « Déjà scanné » au re-scan strict (caméra requise)',
    async ({ page }) => {
      await page.goto(SCAN_URL)
      await attendreManifeste(page)
      await page.getByRole('checkbox', { name: 'Contrôle strict des doublons' }).check()
      // … re-scan caméra mocké du QR déjà scanné …
      const p = panel(page)
      await expect(p).toContainText(/Déjà scanné à \d{2}:\d{2}/)
    },
  )

  test('SCAN-05 — personne sur l’autre date : « Aucun billet à scanner ici » + indice', async ({
    page,
  }) => {
    await page.goto(SCAN_URL)
    await attendreManifeste(page)

    // « Sophie Renaud » est dans le seed sur rep-DIMANCHE (réglée, NON placée) :
    // absente du manifeste rep-samedi → aucun billet ici, mais un indice tiré de
    // l'annuaire global explique pourquoi (autre date).
    await page.getByRole('searchbox').fill('Renaud')
    await expect(page.getByText('Aucun billet à scanner ici.')).toBeVisible()
    await expect(page.getByText('Sophie Renaud')).toBeVisible()
    // Indice de statut « paid » = « réglée mais pas encore placée — Dimanche 15h00 ».
    // (On cible ce texte, pas « Dimanche » seul, qui collisionne avec l'<option>
    // du sélecteur de représentation.)
    await expect(page.getByText(/réglée mais pas encore placée/)).toBeVisible()
  })

  test('SCAN-06 — recherche par « Place » : le billet du siège rang R remonte', async ({ page }) => {
    await page.goto(SCAN_URL)
    await attendreManifeste(page)

    // Le n° de place AFFICHÉ ≠ suffixe du seatId (numérotation pair/impair depuis
    // l'axe central, cf. lib/venue/generate.ts) → on le LIT sur un résultat plutôt
    // que de le supposer.
    await page.getByRole('searchbox').fill(NOM_DUPUIS)
    const first = page.getByRole('listitem').first()
    await expect(first).toContainText(DEMO.placee.name)
    const seatText = await first.innerText()
    const m = /Place (\d+)/.exec(seatText)
    expect(m, 'le libellé de place doit contenir « Place <n> »').not.toBeNull()
    const num = m![1]

    // Critère « Place » = « R<n> » → exactement ce siège de Famille Dupuis.
    await page.getByLabel('Rechercher par').selectOption('place')
    await page.getByRole('searchbox').fill(`R${num}`)
    const placeRow = page.getByRole('listitem').filter({ hasText: `Place ${num}` })
    await expect(placeRow).toHaveCount(1)
    await expect(placeRow).toContainText(DEMO.placee.name)
    await expect(placeRow).toContainText('Rang R')
  })
})
