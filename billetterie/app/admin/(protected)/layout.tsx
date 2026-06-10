// Layout commun du back-office : re-vérifie la session (défense en
// profondeur après proxy.ts) et porte la navigation.

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/require-admin'
import { seDeconnecter } from '@/app/admin/login/actions'
import styles from './admin.module.css'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin()

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <nav className={styles.nav}>
          <span className={styles.brand}>Billetterie</span>
          <Link href="/admin">Tableau de bord</Link>
          <Link href="/admin/demandes">Demandes</Link>
          <Link href="/admin/representations">Représentations</Link>
          <Link href="/admin/plan">Plan de salle</Link>
          <Link href="/admin/scan">Scan</Link>
          <Link href="/admin/calibration">Calibration</Link>
        </nav>
        <form action={seDeconnecter} className={styles.session}>
          <span className={styles.email}>{session.email}</span>
          <button type="submit" className={styles.logout}>
            Déconnexion
          </button>
        </form>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
