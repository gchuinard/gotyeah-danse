// Layout commun du back-office : re-vérifie la session (défense en
// profondeur après proxy.ts) et porte la navigation.

import Link from 'next/link'
import { requireSession } from '@/lib/auth/require-admin'
import { canAccess, type Area } from '@/lib/auth/roles'
import { seDeconnecter } from '@/app/admin/login/actions'
import styles from './admin.module.css'

// Liens du back-office, chacun rattaché à une « zone » (cf. lib/auth/roles).
// La nav est filtrée selon le rôle : un bénévole scan ne voit que « Scan ».
const NAV: { href: string; label: string; area: Area }[] = [
  { href: '/admin', label: 'Tableau de bord', area: 'dashboard' },
  { href: '/admin/demandes', label: 'Demandes', area: 'demandes' },
  { href: '/admin/representations', label: 'Représentations', area: 'representations' },
  { href: '/admin/plan', label: 'Plan de salle', area: 'plan' },
  { href: '/admin/scan', label: 'Scan', area: 'scan' },
  { href: '/admin/stats', label: 'Stats', area: 'stats' },
  { href: '/admin/calibration', label: 'Calibration', area: 'calibration' },
  { href: '/admin/salles', label: 'Salles', area: 'salles' },
  { href: '/admin/comptes', label: 'Comptes', area: 'comptes' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // requireSession (pas requireAdmin) : ce layout enveloppe AUSSI /admin/scan,
  // accessible au rôle scan. Chaque page applique ensuite sa propre garde.
  const session = await requireSession()
  const links = NAV.filter((l) => canAccess(session.role, l.area))

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <nav className={styles.nav}>
          <span className={styles.brand}>Billetterie</span>
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
        <form action={seDeconnecter} className={styles.session}>
          <span className={styles.email}>{session.name || session.email}</span>
          <button type="submit" className={styles.logout}>
            Déconnexion
          </button>
        </form>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
