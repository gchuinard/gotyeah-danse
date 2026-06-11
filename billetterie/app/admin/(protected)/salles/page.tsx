// /admin/salles — salles enregistrées : activer (synchronise le plan
// immédiatement, sans reseed), supprimer, et lien vers le créateur.

import type { Metadata } from 'next'
import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'
import { generateSeats } from '@/lib/venue/generate'
import { loadVenueConfig } from '@/lib/venue/load'
import { parseVenueConfig } from '@/lib/venue/schema'

import {
  activerSalleAction,
  desactiverSalleAction,
  reappliquerPlanAction,
  supprimerSalleAction,
} from './actions'
import styles from './salles-liste.module.css'

export const metadata: Metadata = { title: 'Salles — Billetterie admin' }

const dateCourte = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function premier(valeur: string | string[] | undefined): string {
  return (Array.isArray(valeur) ? valeur[0] : valeur) ?? ''
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export default async function SallesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin()
  const params = await searchParams
  const ok = premier(params.ok)
  const err = premier(params.err)

  const venues = await prisma.venue.findMany({ orderBy: { createdAt: 'desc' } })
  const active = venues.find((v) => v.isActive)

  // Salle par défaut (utilisée quand aucune salle de la liste n'est active).
  const defaut = loadVenueConfig()
  const defautPlaces = generateSeats(defaut).length

  const lignes = venues.map((v) => {
    let places: number | null = null
    try {
      places = generateSeats(parseVenueConfig(JSON.parse(v.config), v.name)).length
    } catch {
      // Config illisible (ne devrait pas arriver : validée à l'enregistrement).
    }
    return { ...v, places }
  })

  return (
    <main className={styles.page}>
      <div className={styles.titre}>
        <h1>Salles</h1>
        <Link className={styles.creer} href="/admin/salles/nouvelle">
          + Créer une salle
        </Link>
      </div>

      {ok && <p className={styles.bannerOk}>{ok}</p>}
      {err && <p className={styles.bannerErr}>{err}</p>}

      <p className={styles.actuelle}>
        Salle en service :{' '}
        <strong>{active ? active.name : (defaut.name ?? 'Salle par défaut')}</strong>{' '}
        {active ? '(enregistrée dans l’admin)' : `(par défaut — ${defautPlaces} places)`}
      </p>

      {lignes.length === 0 ? (
        <p className={styles.vide}>
          Aucune salle enregistrée. Créez-en une avec le créateur, puis « Enregistrer dans la
          billetterie » — vous pourrez l&apos;activer ici, sans reseed.
        </p>
      ) : (
        <ul className={styles.liste}>
          {lignes.map((v) => (
            <li key={v.id} className={v.isActive ? styles.carteActive : styles.carte}>
              <div className={styles.infos}>
                <span className={styles.nom}>
                  {v.name} {v.isActive && <span className={styles.badge}>ACTIVE</span>}
                </span>
                <span className={styles.detail}>
                  {v.places !== null ? `${v.places} places` : 'config illisible'} · créée le{' '}
                  {dateCourte.format(v.createdAt)}
                </span>
              </div>
              <div className={styles.actions}>
                <Link className={styles.secondaire} href={`/admin/salles/${v.id}/modifier`}>
                  Modifier
                </Link>
                {!v.isActive && (
                  <form action={activerSalleAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <button type="submit" className={styles.activer}>
                      Activer
                    </button>
                  </form>
                )}
                {v.isActive && (
                  <>
                    <form action={reappliquerPlanAction}>
                      <button type="submit" className={styles.activer} title="Re-synchronise le plan depuis cette salle (après une modification)">
                        Réappliquer le plan
                      </button>
                    </form>
                    <form action={desactiverSalleAction}>
                      <button type="submit" className={styles.secondaire}>
                        Revenir à la salle par défaut
                      </button>
                    </form>
                  </>
                )}
                {!v.isActive && (
                  <form action={supprimerSalleAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <button type="submit" className={styles.supprimer}>
                      Supprimer
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.aide}>
        <p>
          <strong>Activer</strong> applique le plan immédiatement : sièges créés/mis à jour,
          orphelins supprimés (refusé si des billets existent sur des sièges qui
          disparaîtraient), blocages des sièges retirés nettoyés. Les bascules fixe ↔ amovible
          faites sur le plan sont conservées. À faire <strong>avant</strong> les ventes.
        </p>
      </div>
    </main>
  )
}
