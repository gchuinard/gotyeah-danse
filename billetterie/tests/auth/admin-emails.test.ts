// Liste blanche des admins (lib/auth/admin-emails.ts) — tests purs, pas de DB.
// La seule source de vérité est la variable d'env ADMIN_EMAILS : on la force
// dans chaque cas et on la restaure en afterEach. Piège Node : affecter
// `undefined` à process.env.X écrit la chaîne "undefined" → pour le cas
// « non défini » il faut `delete process.env.ADMIN_EMAILS`.

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { adminEmails, isAdminEmail } from '@/lib/auth/admin-emails'

let envBackup: string | undefined

beforeAll(() => {
  envBackup = process.env.ADMIN_EMAILS
})

afterEach(() => {
  if (envBackup === undefined) {
    delete process.env.ADMIN_EMAILS
  } else {
    process.env.ADMIN_EMAILS = envBackup
  }
})

describe('adminEmails', () => {
  it('non défini → liste vide', () => {
    delete process.env.ADMIN_EMAILS
    expect(adminEmails()).toEqual([])
  })

  it('chaîne vide → liste vide', () => {
    process.env.ADMIN_EMAILS = ''
    expect(adminEmails()).toEqual([])
  })

  it('un seul email', () => {
    process.env.ADMIN_EMAILS = 'pascale@exemple.fr'
    expect(adminEmails()).toEqual(['pascale@exemple.fr'])
  })

  it('plusieurs emails séparés par des virgules', () => {
    process.env.ADMIN_EMAILS = 'pascale@exemple.fr,aurore@exemple.fr'
    expect(adminEmails()).toEqual(['pascale@exemple.fr', 'aurore@exemple.fr'])
  })

  it('espaces autour des emails → retirés (trim)', () => {
    process.env.ADMIN_EMAILS = '  pascale@exemple.fr ,  aurore@exemple.fr  '
    expect(adminEmails()).toEqual(['pascale@exemple.fr', 'aurore@exemple.fr'])
  })

  it('casse → normalisée en minuscules', () => {
    process.env.ADMIN_EMAILS = 'Pascale@Exemple.FR,AURORE@exemple.fr'
    expect(adminEmails()).toEqual(['pascale@exemple.fr', 'aurore@exemple.fr'])
  })

  it('entrées vides (virgules en trop, blancs) → filtrées', () => {
    process.env.ADMIN_EMAILS = 'a@exemple.fr,,b@exemple.fr,   ,c@exemple.fr,'
    expect(adminEmails()).toEqual(['a@exemple.fr', 'b@exemple.fr', 'c@exemple.fr'])
  })

  it('que des séparateurs et des blancs → liste vide', () => {
    process.env.ADMIN_EMAILS = ',  , ,,'
    expect(adminEmails()).toEqual([])
  })
})

describe('isAdminEmail', () => {
  it('vrai pour un email présent dans la liste', () => {
    process.env.ADMIN_EMAILS = 'pascale@exemple.fr,aurore@exemple.fr'
    expect(isAdminEmail('pascale@exemple.fr')).toBe(true)
    expect(isAdminEmail('aurore@exemple.fr')).toBe(true)
  })

  it('insensible à la casse', () => {
    process.env.ADMIN_EMAILS = 'pascale@exemple.fr'
    expect(isAdminEmail('PASCALE@Exemple.FR')).toBe(true)
  })

  it('trim de l’entrée (espaces autour ignorés)', () => {
    process.env.ADMIN_EMAILS = 'pascale@exemple.fr'
    expect(isAdminEmail('  pascale@exemple.fr  ')).toBe(true)
  })

  it('faux pour un email absent de la liste', () => {
    process.env.ADMIN_EMAILS = 'pascale@exemple.fr'
    expect(isAdminEmail('inconnu@exemple.fr')).toBe(false)
  })

  it('faux quand ADMIN_EMAILS n’est pas défini', () => {
    delete process.env.ADMIN_EMAILS
    expect(isAdminEmail('pascale@exemple.fr')).toBe(false)
  })

  it('faux pour une entrée vide ou en blanc (jamais admin)', () => {
    process.env.ADMIN_EMAILS = 'pascale@exemple.fr'
    expect(isAdminEmail('')).toBe(false)
    expect(isAdminEmail('   ')).toBe(false)
  })
})
