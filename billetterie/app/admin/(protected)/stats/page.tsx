// /admin/stats — mini-statistiques par représentation + réconciliation de
// caisse. Tout est calculé à la volée (pas de table dédiée) : remplissage,
// répartition des tailles de groupes, no-shows, et totaux encaissés par mode
// de règlement (saisis au « marquer payée »).

import type { Metadata } from 'next'
import Link from 'next/link'

import { invendusLigne, recetteLigneCents, totauxBuvette } from '@/lib/admin/buvette'
import { MOMENTS, SKY_OPTIONS, parseWeatherReadings } from '@/lib/admin/weather'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

import {
  ajouterBuvetteAction,
  enregistrerBilanAction,
  modifierBuvetteAction,
  supprimerBuvetteAction,
} from './actions'
import styles from './stats.module.css'

export const metadata: Metadata = { title: 'Statistiques — Billetterie admin' }

const dateHeureFr = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
})

const METHODE_LABELS: Record<string, string> = {
  especes: 'Espèces',
  cheque: 'Chèques',
  autre: 'Autre',
  inconnu: 'Non renseigné',
}

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}

export default async function StatsPage() {
  await requireAdmin()
  const now = new Date()

  const [representations, totalSieges] = await Promise.all([
    prisma.representation.findMany({ orderBy: { startsAt: 'asc' } }),
    prisma.seat.count(),
  ])

  const stats = await Promise.all(
    representations.map(async (rep) => {
      const [overrides, billets, scannes, bookings, buvette] = await Promise.all([
        prisma.seatOverride.count({ where: { representationId: rep.id } }),
        prisma.ticket.count({ where: { representationId: rep.id } }),
        prisma.ticket.count({ where: { representationId: rep.id, scannedAt: { not: null } } }),
        prisma.booking.findMany({
          where: { representationId: rep.id },
          select: { status: true, partySize: true, paymentMethod: true, amountCents: true },
        }),
        prisma.buvetteItem.findMany({
          where: { representationId: rep.id },
          orderBy: { createdAt: 'asc' },
        }),
      ])

      const capacite = totalSieges - overrides
      const parStatut = new Map<string, number>()
      const parTaille = new Map<number, number>()
      // Caisse : demandes payées ou placées (l'argent est encaissé dans les 2 cas).
      const caisse = new Map<string, { nb: number; total: number; sansMontant: number }>()

      for (const b of bookings) {
        parStatut.set(b.status, (parStatut.get(b.status) ?? 0) + 1)
        if (['pending', 'paid', 'placed'].includes(b.status)) {
          parTaille.set(b.partySize, (parTaille.get(b.partySize) ?? 0) + 1)
        }
        if (['paid', 'placed'].includes(b.status)) {
          const methode = b.paymentMethod ?? 'inconnu'
          const ligne = caisse.get(methode) ?? { nb: 0, total: 0, sansMontant: 0 }
          ligne.nb += 1
          if (b.amountCents !== null) ligne.total += b.amountCents
          else ligne.sansMontant += 1
          caisse.set(methode, ligne)
        }
      }

      const totalCaisse = [...caisse.values()].reduce((s, l) => s + l.total, 0)
      const passee = rep.startsAt < now

      return {
        rep,
        capacite,
        billets,
        scannes,
        remplissage: capacite > 0 ? Math.round((billets / capacite) * 100) : 0,
        noShows: passee ? billets - scannes : null,
        parStatut,
        parTaille,
        caisse,
        totalCaisse,
        buvette,
        buvetteTotaux: totauxBuvette(buvette),
      }
    }),
  )

  return (
    <main className={styles.page}>
      <h1>Statistiques</h1>

      {stats.map(({ rep, ...s }) => {
        const meteo = parseWeatherReadings(rep.weatherReadings)
        return (
        <section key={rep.id} className={styles.bloc}>
          <header className={styles.blocHeader}>
            <h2>{rep.title}</h2>
            <span className={styles.date}>
              {dateHeureFr.format(rep.startsAt).replace(/(\d{1,2}):(\d{2})/, '$1h$2')}
            </span>
          </header>

          <div className={styles.grille}>
            <div className={styles.carte}>
              <h3>Remplissage</h3>
              <p className={styles.gros}>
                {s.billets} / {s.capacite} <small>({s.remplissage} %)</small>
              </p>
              <p className={styles.detail}>billets émis / sièges actifs</p>
              {s.noShows !== null && (
                <p className={styles.detail}>
                  Entrées scannées : <strong>{s.scannes}</strong> — no-shows :{' '}
                  <strong>{s.noShows}</strong>
                </p>
              )}
            </div>

            <div className={styles.carte}>
              <h3>Demandes</h3>
              <ul className={styles.liste}>
                {(
                  [
                    ['pending', 'En attente'],
                    ['paid', 'À placer'],
                    ['placed', 'Placées'],
                    ['cancelled', 'Annulées'],
                    ['expired', 'Expirées'],
                  ] as const
                ).map(([statut, label]) => (
                  <li key={statut}>
                    {label} : <strong>{s.parStatut.get(statut) ?? 0}</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div className={styles.carte}>
              <h3>Tailles de groupes</h3>
              {s.parTaille.size === 0 ? (
                <p className={styles.detail}>Aucune demande active.</p>
              ) : (
                <ul className={styles.liste}>
                  {[...s.parTaille.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([taille, nb]) => (
                      <li key={taille}>
                        {taille} place{taille > 1 ? 's' : ''} : <strong>{nb}</strong> demande
                        {nb > 1 ? 's' : ''}
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className={styles.carte}>
              <h3>Caisse</h3>
              {s.caisse.size === 0 ? (
                <p className={styles.detail}>Aucun règlement enregistré.</p>
              ) : (
                <>
                  <ul className={styles.liste}>
                    {[...s.caisse.entries()].map(([methode, ligne]) => (
                      <li key={methode}>
                        {METHODE_LABELS[methode] ?? methode} : <strong>{euros(ligne.total)}</strong>{' '}
                        ({ligne.nb} demande{ligne.nb > 1 ? 's' : ''}
                        {ligne.sansMontant > 0 ? `, ${ligne.sansMontant} sans montant` : ''})
                      </li>
                    ))}
                  </ul>
                  <p className={styles.totalCaisse}>Total : {euros(s.totalCaisse)}</p>
                </>
              )}
              <p className={styles.detail}>
                Renseigné au « Marquer payée » dans{' '}
                <Link href={`/admin/demandes?rep=${rep.id}`}>les demandes</Link>.
              </p>
            </div>
          </div>

          <div className={styles.bilan} id={`rep-${rep.id}`}>
            <h3>Bilan d’organisation</h3>

            <form action={enregistrerBilanAction} className={styles.bilanForm}>
              <input type="hidden" name="repId" value={rep.id} />

              <fieldset className={styles.meteoFieldset}>
                <legend className={styles.meteoLegend}>Météo du soir</legend>
                {rep.weather && (
                  <p className={styles.meteoLegacy}>Ancienne saisie : {rep.weather}</p>
                )}
                <div className={styles.meteoEntete} aria-hidden="true">
                  <span>Moment</span>
                  <span>Ciel</span>
                  <span>Temp.</span>
                </div>
                {MOMENTS.map((m) => (
                  <div key={m.key} className={styles.meteoLigne}>
                    <span className={styles.meteoMoment}>{m.label}</span>
                    <select
                      name={`sky_${m.key}`}
                      defaultValue={meteo[m.key].sky}
                      aria-label={`Ciel — ${m.label}`}
                    >
                      {SKY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className={styles.meteoTemp}>
                      <input
                        name={`temp_${m.key}`}
                        type="number"
                        inputMode="numeric"
                        step={1}
                        min={-30}
                        max={60}
                        defaultValue={meteo[m.key].tempC ?? ''}
                        aria-label={`Température — ${m.label}`}
                      />
                      <span aria-hidden="true">°C</span>
                    </span>
                  </div>
                ))}
              </fieldset>
              <label className={styles.bilanChamp}>
                <span>Notes / à retenir pour l’an prochain</span>
                <textarea
                  name="orgNotes"
                  rows={3}
                  maxLength={2000}
                  defaultValue={rep.orgNotes ?? ''}
                  placeholder="Ce qui s’est bien / mal vendu, prix à ajuster, idées…"
                />
              </label>
              <button type="submit" className={styles.bilanBtn}>
                Enregistrer météo &amp; notes
              </button>
            </form>

            <h4 className={styles.buvetteTitre}>Buvette</h4>
            <div className={styles.buvette}>
              <div className={`${styles.buvetteLigne} ${styles.buvetteEntete}`}>
                <span>Article</span>
                <span>Proposé</span>
                <span>Vendu</span>
                <span>Prix</span>
                <span>Recette</span>
                <span>Invendus</span>
                <span aria-hidden="true" />
              </div>

              {s.buvette.map((it) => (
                <form key={it.id} action={modifierBuvetteAction} className={styles.buvetteLigne}>
                  <input type="hidden" name="id" value={it.id} />
                  <input type="hidden" name="repId" value={rep.id} />
                  <input name="label" defaultValue={it.label} maxLength={60} aria-label="Article" />
                  <input
                    name="qtyStock"
                    type="number"
                    min={0}
                    defaultValue={it.qtyStock}
                    aria-label="Proposé"
                  />
                  <input
                    name="qtySold"
                    type="number"
                    min={0}
                    defaultValue={it.qtySold}
                    aria-label="Vendu"
                  />
                  <input
                    name="prix"
                    inputMode="decimal"
                    defaultValue={(it.unitPriceCents / 100).toString()}
                    aria-label="Prix en euros"
                  />
                  <span className={styles.buvetteCalc}>{euros(recetteLigneCents(it))}</span>
                  <span className={styles.buvetteCalc}>{invendusLigne(it)}</span>
                  <span className={styles.buvetteActions}>
                    <button type="submit" className={styles.btnMini} title="Enregistrer">
                      OK
                    </button>
                    <button
                      type="submit"
                      formAction={supprimerBuvetteAction}
                      className={styles.btnMiniDanger}
                      title="Supprimer cet article"
                      aria-label="Supprimer"
                    >
                      ✕
                    </button>
                  </span>
                </form>
              ))}

              <form
                action={ajouterBuvetteAction}
                className={`${styles.buvetteLigne} ${styles.buvetteAjout}`}
              >
                <input type="hidden" name="repId" value={rep.id} />
                <input name="label" placeholder="Article (ex. Coca)" maxLength={60} required aria-label="Nouvel article" />
                <input name="qtyStock" type="number" min={0} placeholder="Proposé" aria-label="Proposé" />
                <input name="qtySold" type="number" min={0} placeholder="Vendu" aria-label="Vendu" />
                <input name="prix" inputMode="decimal" placeholder="Prix €" aria-label="Prix en euros" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span className={styles.buvetteActions}>
                  <button type="submit" className={styles.btnMini}>
                    + Ajouter
                  </button>
                </span>
              </form>
            </div>

            {s.buvette.length > 0 && (
              <p className={styles.buvetteTotal}>
                Recette buvette : <strong>{euros(s.buvetteTotaux.recetteCents)}</strong> ·{' '}
                {s.buvetteTotaux.venduTotal} vendus · {s.buvetteTotaux.invendusTotal} invendus
              </p>
            )}
          </div>
        </section>
        )
      })}
    </main>
  )
}
