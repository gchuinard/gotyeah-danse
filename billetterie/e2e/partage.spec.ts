// E2E — Partage d'une place (cahier de test, cas PART-01 à PART-07).
//
// Tout est PUBLIC ici : la page de suivi /billets/<token> (statut « placé »),
// puis /place (email + code, ou lien direct /place/<qrToken>). Aucune session
// forgée, lecture seule → rien à restaurer sur la base seedée.
//
// Le code court attendu (« FD#### ») est calculé via la VRAIE fonction pure
// codePlace — la même que le rendu serveur — pour ne jamais coder en dur une
// valeur magique : si la dérivation change, le test bouge avec elle.

import { expect, test, type Page } from '@playwright/test'

import { codePlace } from '../lib/booking/code-place'
import { DEMO } from './data'

// Place de référence : le 1er billet de la résa placée « Famille Dupuis ».
const qrToken0 = DEMO.placee.qrTokens[0]
const code0 = codePlace(qrToken0, DEMO.placee.name)

// La page placée affiche 4 blocs « partage » (un par billet). On cible CELUI
// qui porte code0 via son code visible — robuste à l'ordre de rendu des sièges.
const blocDuCode = (page: Page) => page.getByRole('article').filter({ hasText: code0 })

test('PART-01 — chaque place montre son code XX#### + boutons Copier/Partager (masqués à l’impression)', async ({
  page,
}) => {
  await page.goto(`/billets/${DEMO.placee.token}`)

  // « Famille Dupuis » → initiales FD + 4 chiffres (3 dérivés + contrôle).
  expect(code0).toMatch(/^FD\d{4}$/)

  const bloc = blocDuCode(page)
  await expect(bloc.getByText('Code de cette place :')).toBeVisible()
  await expect(bloc.getByText(code0, { exact: true })).toBeVisible()
  await expect(bloc.getByRole('button', { name: 'Copier', exact: true })).toBeVisible()
  await expect(bloc.getByRole('button', { name: 'Partager', exact: true })).toBeVisible()

  // Bloc « écran seulement » : @media print → display:none → absent à l'impression.
  await page.emulateMedia({ media: 'print' })
  await expect(bloc.getByRole('button', { name: 'Copier', exact: true })).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
})

test('PART-02 — « Copier » met le code dans le presse-papier + toast « Code copié »', async ({
  page,
}) => {
  await page.goto(`/billets/${DEMO.placee.token}`)
  const bloc = blocDuCode(page)

  await bloc.getByRole('button', { name: 'Copier', exact: true }).click()

  await expect(bloc.getByText(/Code copié/)).toBeVisible()
  const presse = await page.evaluate(() => navigator.clipboard.readText())
  expect(presse).toBe(code0)
})

test('PART-03 — menu « Partager » → « Copier le lien » copie l’URL /place/<qrToken> + toast', async ({
  page,
}) => {
  await page.goto(`/billets/${DEMO.placee.token}`)
  const bloc = blocDuCode(page)

  await bloc.getByRole('button', { name: 'Partager', exact: true }).click()

  const menu = bloc.getByRole('menu')
  await expect(menu).toBeVisible()
  // En headless, navigator.share est absent → PAS d'item « Partage du téléphone… ».
  // Le repli desktop n'expose donc que ces 4 canaux explicites.
  await expect(menu.getByRole('menuitem')).toHaveCount(4)
  await expect(menu.getByRole('menuitem', { name: 'WhatsApp' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'SMS' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'E-mail' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Copier le lien' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Partage du téléphone' })).toHaveCount(0)

  await menu.getByRole('menuitem', { name: 'Copier le lien' }).click()

  await expect(bloc.getByText(/Lien copié/)).toBeVisible()
  const presse = await page.evaluate(() => navigator.clipboard.readText())
  // Le message dicté se termine par le lien direct /place/<qrToken> (rien à taper).
  expect(presse).toContain(`/place/${qrToken0}`)
  expect(presse.endsWith(`/place/${qrToken0}`)).toBe(true)
  expect(presse).toContain('rang R')
})

test('PART-04 — /place (email + code) → carte lecture seule (section/rang/place + groupe), aucune action', async ({
  page,
}) => {
  await page.goto('/place')
  await page.getByLabel('Email de la réservation').fill(DEMO.placee.email)
  await page.getByLabel('Code de la place').fill(code0)
  await page.getByRole('button', { name: 'Voir ma place' }).click()

  const carte = page.getByRole('article')
  await expect(carte.getByText('Lecture seule · place partagée')).toBeVisible()

  // Valeur (dd) associée à un libellé (dt) via le couple <div><dt/><dd/></div>.
  const valeurDe = (label: string) =>
    carte
      .locator('div')
      .filter({ has: page.getByRole('term', { name: label, exact: true }) })
      .getByRole('definition')
  await expect(valeurDe('Section')).toHaveText('Centre')
  await expect(valeurDe('Rang')).toHaveText('R')
  await expect(valeurDe('Place')).toHaveText(/^\d+$/)

  // Récap « groupe de <prénom> » : prénom = 1er mot du nom → « Famille ».
  await expect(carte.getByText(/groupe de\s+Famille/)).toBeVisible()

  // Lecture seule : aucune action de partage/copie. (Le QR reste un viewer
  // « plein écran » — c'est le seul bouton attendu dans la carte.)
  await expect(carte.getByRole('button', { name: 'Copier', exact: true })).toHaveCount(0)
  await expect(carte.getByRole('button', { name: 'Partager', exact: true })).toHaveCount(0)
})

test('PART-05 — bon code mais autre email → « Email ou code incorrect » (cadrage par email)', async ({
  page,
}) => {
  await page.goto('/place')
  // Email d'une AUTRE réservation (Julien Moreau) + code de Famille Dupuis :
  // le périmètre email doit empêcher de voir la place d'un inconnu.
  await page.getByLabel('Email de la réservation').fill(DEMO.payeeSoldee.email)
  await page.getByLabel('Code de la place').fill(code0)
  await page.getByRole('button', { name: 'Voir ma place' }).click()

  await expect(page.getByRole('alert')).toContainText('Email ou code incorrect')
  await expect(page.getByText('Lecture seule · place partagée')).toHaveCount(0)
})

test('PART-06 — code avec un chiffre faux → rejeté (« Email ou code incorrect »)', async ({
  page,
}) => {
  // On fausse le chiffre de contrôle (dernier caractère) : la forme reste
  // XX#### mais le contrôle ne matche plus → écarté sans même requêter la base.
  const codeFaux = code0.slice(0, 5) + String((Number(code0[5]) + 1) % 10)
  expect(codeFaux).not.toBe(code0)

  await page.goto('/place')
  await page.getByLabel('Email de la réservation').fill(DEMO.placee.email)
  await page.getByLabel('Code de la place').fill(codeFaux)
  await page.getByRole('button', { name: 'Voir ma place' }).click()

  await expect(page.getByRole('alert')).toContainText('Email ou code incorrect')
})

test('PART-07 — lien direct /place/<qrToken> : vrai → carte lecture seule ; token bidon → 404', async ({
  page,
}) => {
  const reponse = await page.goto(`/place/${qrToken0}`)
  expect(reponse?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Votre place' })).toBeVisible()
  const carte = page.getByRole('article')
  await expect(carte.getByText('Lecture seule · place partagée')).toBeVisible()
  await expect(carte.getByText(/groupe de\s+Famille/)).toBeVisible()

  const bidon = await page.goto('/place/inexistant')
  expect(bidon?.status()).toBe(404)
})
