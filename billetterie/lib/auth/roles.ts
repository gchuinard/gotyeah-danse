// Rôles admin — source unique des permissions. Trois niveaux :
//  - super-admin : tout (dont calibration, salles, représentations, comptes) ;
//  - admin       : tout SAUF calibration, salles, représentations, comptes ;
//  - scan        : uniquement la page de scan.
// Pas de table de permissions : une simple carte zone → rôles autorisés.

export const ROLES = ['super-admin', 'admin', 'scan'] as const
export type Role = (typeof ROLES)[number]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

// Rôles attribuables à un compte en base (le rôle « scan » passe par le PIN
// partagé, pas par un compte).
export const ACCOUNT_ROLES = ['super-admin', 'admin'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

// Zones du back-office et rôles qui peuvent y accéder.
export const AREA_ROLES = {
  dashboard: ['super-admin', 'admin'],
  demandes: ['super-admin', 'admin'],
  placement: ['super-admin', 'admin'],
  plan: ['super-admin', 'admin'],
  stats: ['super-admin', 'admin'],
  scan: ['super-admin', 'admin', 'scan'],
  calibration: ['super-admin'],
  salles: ['super-admin'],
  representations: ['super-admin'],
  comptes: ['super-admin'],
} as const satisfies Record<string, readonly Role[]>

export type Area = keyof typeof AREA_ROLES

export function canAccess(role: Role, area: Area): boolean {
  return (AREA_ROLES[area] as readonly Role[]).includes(role)
}

// Page d'accueil selon le rôle : un bénévole scan n'a que /admin/scan.
export function homeFor(role: Role): string {
  return role === 'scan' ? '/admin/scan' : '/admin'
}

// Libellé court pour l'UI.
export function roleLabel(role: Role): string {
  switch (role) {
    case 'super-admin':
      return 'Super-admin'
    case 'admin':
      return 'Admin'
    case 'scan':
      return 'Scan'
  }
}
