// /admin/comptes — gestion des accès (super-admin uniquement) :
//  - super-admins « garantis » du .env (lecture seule) ;
//  - comptes gérés en base : ajout, changement de rôle, suppression ;
//  - PIN partagé du mode scan (définir / désactiver).

import type { Metadata } from 'next'

import { envSuperAdmins, listAdminAccounts } from '@/lib/auth/admin-accounts'
import { requireSuperAdmin } from '@/lib/auth/require-admin'
import { roleLabel } from '@/lib/auth/roles'
import { isScanPinSet } from '@/lib/auth/scan-pin'
import { prisma } from '@/lib/db'
import { ConfirmSubmit } from '../demandes/confirm-submit'
import {
  ajouterCompte,
  changerRole,
  definirPinScan,
  desactiverPinScan,
  supprimerCompte,
} from './actions'
import styles from './comptes.module.css'

export const metadata: Metadata = { title: 'Comptes — Admin' }
export const dynamic = 'force-dynamic'

const dateFr = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function ComptesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSuperAdmin()
  const params = await searchParams
  const ok = premier(params.ok)
  const err = premier(params.err)

  const [accounts, pinSet] = await Promise.all([
    listAdminAccounts(prisma),
    isScanPinSet(prisma),
  ])
  const envAdmins = envSuperAdmins()

  return (
    <main>
      <h1 className={styles.title}>Comptes &amp; accès</h1>

      {ok && <p className={styles.bannerOk}>{ok}</p>}
      {err && <p className={styles.bannerErr}>{err}</p>}

      <h2 className={styles.subtitle}>Super-admins (configuration serveur)</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Email</th>
            <th>Rôle</th>
          </tr>
        </thead>
        <tbody>
          {envAdmins.map((email) => (
            <tr key={email}>
              <td className={styles.mono}>
                {email}
                {email === session.email && <span className={styles.you}> (vous)</span>}
              </td>
              <td>
                <span className={styles.badge}>Super-admin</span>
              </td>
            </tr>
          ))}
          {envAdmins.length === 0 && (
            <tr>
              <td colSpan={2} className={styles.empty}>
                Aucun email dans ADMIN_EMAILS.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className={styles.hint}>
        Définis dans <code>ADMIN_EMAILS</code> (.env) — toujours super-admin, modifiables uniquement
        côté serveur.
      </p>

      <h2 className={styles.subtitle}>Comptes gérés ici</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Email</th>
            <th>Rôle</th>
            <th>Créé</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td className={styles.mono}>
                {a.email}
                {a.email === session.email && <span className={styles.you}> (vous)</span>}
              </td>
              <td>
                <form action={changerRole} className={styles.inline}>
                  <input type="hidden" name="id" value={a.id} />
                  <select name="role" defaultValue={a.role} className={styles.select}>
                    <option value="admin">Admin</option>
                    <option value="super-admin">Super-admin</option>
                  </select>
                  <button type="submit" className={styles.btn}>
                    Appliquer
                  </button>
                </form>
              </td>
              <td>{dateFr.format(a.createdAt)}</td>
              <td className={styles.actions}>
                <form action={supprimerCompte}>
                  <input type="hidden" name="id" value={a.id} />
                  <ConfirmSubmit
                    className={`${styles.btn} ${styles.btnDanger}`}
                    message={`Supprimer le compte ${a.email} ?`}
                  >
                    Supprimer
                  </ConfirmSubmit>
                </form>
              </td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={4} className={styles.empty}>
                Aucun compte en base — ajoute-en un ci-dessous.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className={styles.createCard}>
        <h2 className={styles.subtitle}>Ajouter un compte</h2>
        <form action={ajouterCompte} className={styles.createForm}>
          <label className={styles.field}>
            Email
            <input
              className={styles.input}
              type="email"
              name="email"
              placeholder="benevole@exemple.fr"
              maxLength={200}
              required
            />
          </label>
          <label className={styles.field}>
            Rôle
            <select className={styles.input} name="role" defaultValue="admin">
              <option value="admin">Admin (tout sauf calibration, salles, représentations)</option>
              <option value="super-admin">Super-admin (tout)</option>
            </select>
          </label>
          <button type="submit" className={styles.btnPrimary}>
            Ajouter
          </button>
        </form>
        <p className={styles.hint}>
          Le compte se connecte avec son email + un code reçu par email (comme les super-admins). Le
          rôle <strong>{roleLabel('scan')}</strong>{' '}n&rsquo;a pas de compte : il passe par le PIN
          ci-dessous.
        </p>
      </section>

      <section className={styles.createCard}>
        <h2 className={styles.subtitle}>Accès scan (PIN partagé)</h2>
        <p className={pinSet ? styles.statusOk : styles.statusOff}>
          {pinSet
            ? 'Un PIN est configuré : les bénévoles peuvent accéder au scan.'
            : 'Aucun PIN — le mode scan est désactivé.'}
        </p>
        <form action={definirPinScan} className={styles.createForm}>
          <label className={styles.field}>
            {pinSet ? 'Nouveau PIN' : 'PIN'} (4 à 8 chiffres)
            <input
              className={styles.input}
              type="text"
              name="pin"
              inputMode="numeric"
              pattern="\d{4,8}"
              maxLength={8}
              autoComplete="off"
              required
            />
          </label>
          <button type="submit" className={styles.btnPrimary}>
            Enregistrer le PIN
          </button>
        </form>
        {pinSet && (
          <form action={desactiverPinScan} className={styles.clearForm}>
            <ConfirmSubmit
              className={`${styles.btn} ${styles.btnDanger}`}
              message="Désactiver l'accès scan (supprimer le PIN) ?"
            >
              Désactiver l&rsquo;accès scan
            </ConfirmSubmit>
          </form>
        )}
        <p className={styles.hint}>
          Les bénévoles accèdent au scan avec leur <strong>prénom + ce PIN</strong>. Communiquez-le
          le soir du spectacle ; le prénom sert à tracer qui a scanné.
        </p>
      </section>
    </main>
  )
}
