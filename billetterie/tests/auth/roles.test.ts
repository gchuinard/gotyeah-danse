// Tests purs des permissions par rôle (lib/auth/roles.ts) — pas de DB.

import { describe, expect, it } from 'vitest'

import { AREA_ROLES, canAccess, homeFor, isRole, type Area } from '@/lib/auth/roles'

describe('isRole', () => {
  it('reconnaît les rôles valides et rejette le reste', () => {
    expect(isRole('super-admin')).toBe(true)
    expect(isRole('admin')).toBe(true)
    expect(isRole('scan')).toBe(true)
    expect(isRole('root')).toBe(false)
    expect(isRole(undefined)).toBe(false)
    expect(isRole(42)).toBe(false)
  })
})

describe('canAccess', () => {
  const ADMIN_ONLY: Area[] = ['calibration', 'salles', 'representations', 'comptes']
  const SHARED: Area[] = ['dashboard', 'demandes', 'placement', 'plan', 'stats']

  it('super-admin accède à TOUT', () => {
    for (const area of Object.keys(AREA_ROLES) as Area[]) {
      expect(canAccess('super-admin', area)).toBe(true)
    }
  })

  it('admin accède aux zones courantes mais pas aux zones super-admin', () => {
    for (const area of SHARED) expect(canAccess('admin', area)).toBe(true)
    expect(canAccess('admin', 'scan')).toBe(true)
    for (const area of ADMIN_ONLY) expect(canAccess('admin', area)).toBe(false)
  })

  it('scan n’accède QU’À la page scan', () => {
    expect(canAccess('scan', 'scan')).toBe(true)
    for (const area of [...SHARED, ...ADMIN_ONLY]) {
      expect(canAccess('scan', area)).toBe(false)
    }
  })
})

describe('homeFor', () => {
  it('renvoie /admin/scan pour scan, /admin sinon', () => {
    expect(homeFor('scan')).toBe('/admin/scan')
    expect(homeFor('admin')).toBe('/admin')
    expect(homeFor('super-admin')).toBe('/admin')
  })
})
