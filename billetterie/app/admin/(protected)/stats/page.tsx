// /admin/stats — mini-statistiques par représentation + réconciliation de
// caisse. Tout est calculé à la volée (pas de table dédiée) : remplissage,
// répartition des tailles de groupes, no-shows, et totaux encaissés par mode
// de règlement (saisis au « marquer payée »).

import type { Metadata } from 'next'
import Link from 'next/link'

import { totauxBuvette } from '@/lib/admin/buvette'
import { euros, resumePaiement } from '@/lib/admin/money'
import { getTicketPriceCents } from '@/lib/admin/pricing'
import { MOMENTS, SKY_OPTIONS, parseWeatherReadings } from '@/lib/admin/weather'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

import { ajouterBuvetteAction, enregistrerBilanAction } from './actions'
import { BuvetteRow } from './buvette-row'
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

// Mois + année (« juillet 2026 ») et jour court — pour les chèques à déposer.
const moisAnnee = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  month: 'long',
  year: 'numeric',
})
const jourCourt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
})
// Clé de tri d'un mois (AAAA-MM en heure de Paris) indépendante de la locale.
const cleMois = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
})

export default async function StatsPage() {
  await requireAdmin()
  const now = new Date()

  const [representations, totalSieges, unitPriceCents] = await Promise.all([
    prisma.representation.findMany({ orderBy: { startsAt: 'asc' } }),
    prisma.seat.count(),
    getTicketPriceCents(prisma),
  ])

  const stats = await Promise.all(
    representations.map(async (rep) => {
      const [overrides, billets, scannes, bookings, buvette] = await Promise.all([
        prisma.seatOverride.count({ where: { representationId: rep.id } }),
        prisma.ticket.count({ where: { representationId: rep.id } }),
        prisma.ticket.count({ where: { representationId: rep.id, scannedAt: { not: null } } }),
        prisma.booking.findMany({
          where: { representationId: rep.id },
          select: {
            status: true,
            partySize: true,
            freeSeats: true,
            refundCents: true,
            name: true,
            paidAt: true,
            payments: {
              select: { method: true, amountCents: true, depositOn: true },
            },
          },
        }),
        prisma.buvetteItem.findMany({
          where: { representationId: rep.id },
          orderBy: { createdAt: 'asc' },
        }),
      ])

      const capacite = totalSieges - overrides
      const parStatut = new Map<string, number>()
      const parTaille = new Map<number, number>()
      // Caisse : tous les versements comptent DÈS la remise (un chèque non encore
      // déposé est déjà dans la caisse). Ventilation par méthode ; le remboursé
      // est global (non rattaché à une méthode) → net = reçu − remboursé.
      const caisse = new Map<string, { nb: number; total: number }>()
      let rembourseCents = 0
      let resteAEncaisserCents = 0 // acomptes restant à compléter (demandes réglées)
      let tropPercuCents = 0 // sur-paiements à régulariser
      let demandesSansMontant = 0 // héritage : payées sans montant saisi
      // Chèques avec une date de dépôt prévue, groupés par mois.
      const cheques: { name: string; amountCents: number; depositOn: Date }[] = []

      for (const b of bookings) {
        parStatut.set(b.status, (parStatut.get(b.status) ?? 0) + 1)
        if (['pending', 'paid', 'placed'].includes(b.status)) {
          parTaille.set(b.partySize, (parTaille.get(b.partySize) ?? 0) + 1)
        }
        // L'argent ne compte que pour les demandes ACTIVES réglées (paid/placed).
        // Une demande annulée a déjà ses versements purgés (annulerDemande), ce
        // garde-fou évite tout résidu (chèque à déposer, net) en cas d'anomalie.
        if (!['paid', 'placed'].includes(b.status)) continue
        for (const p of b.payments) {
          const ligne = caisse.get(p.method) ?? { nb: 0, total: 0 }
          ligne.nb += 1
          ligne.total += p.amountCents
          caisse.set(p.method, ligne)
          if (p.method === 'cheque' && p.depositOn) {
            cheques.push({ name: b.name, amountCents: p.amountCents, depositOn: p.depositOn })
          }
        }
        rembourseCents += b.refundCents ?? 0
        // Une demande payée sans montant saisi (héritage) compte UNIQUEMENT comme
        // « sans montant » — jamais aussi dans le reste à encaisser (sinon on
        // réclamerait un argent déjà collecté).
        if (b.paidAt && b.payments.length === 0) {
          demandesSansMontant += 1
        } else {
          const r = resumePaiement({
            partySize: b.partySize,
            freeSeats: b.freeSeats,
            unitPriceCents,
            payments: b.payments,
            refundCents: b.refundCents,
          })
          if (r.resteCents) resteAEncaisserCents += r.resteCents
          tropPercuCents += r.tropPercuCents
        }
      }

      const totalRecu = [...caisse.values()].reduce((s, l) => s + l.total, 0)
      const totalCaisse = totalRecu - rembourseCents

      // Chèques à déposer, regroupés par mois (chronologique).
      const chequesParMois = new Map<
        string,
        { label: string; total: number; items: { name: string; amountCents: number; jour: string }[] }
      >()
      for (const c of [...cheques].sort((a, b) => a.depositOn.getTime() - b.depositOn.getTime())) {
        const key = cleMois.format(c.depositOn)
        const grp =
          chequesParMois.get(key) ?? { label: moisAnnee.format(c.depositOn), total: 0, items: [] }
        grp.total += c.amountCents
        grp.items.push({ name: c.name, amountCents: c.amountCents, jour: jourCourt.format(c.depositOn) })
        chequesParMois.set(key, grp)
      }
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
        totalRecu,
        rembourseCents,
        totalCaisse,
        resteAEncaisserCents,
        tropPercuCents,
        demandesSansMontant,
        chequesMois: [...chequesParMois.values()],
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
                <p className={styles.detail}>Aucun versement enregistré.</p>
              ) : (
                <>
                  <ul className={styles.liste}>
                    {[...s.caisse.entries()].map(([methode, ligne]) => (
                      <li key={methode}>
                        {METHODE_LABELS[methode] ?? methode} : <strong>{euros(ligne.total)}</strong>{' '}
                        ({ligne.nb} versement{ligne.nb > 1 ? 's' : ''})
                      </li>
                    ))}
                    {s.rembourseCents > 0 && (
                      <li>
                        Remboursé : <strong>− {euros(s.rembourseCents)}</strong>
                      </li>
                    )}
                  </ul>
                  <p className={styles.totalCaisse}>Total net : {euros(s.totalCaisse)}</p>
                </>
              )}
              {s.resteAEncaisserCents > 0 && (
                <p className={styles.detail}>
                  Reste à encaisser (acomptes) : <strong>{euros(s.resteAEncaisserCents)}</strong>
                </p>
              )}
              {s.tropPercuCents > 0 && (
                <p className={styles.detail}>
                  Trop-perçu à régulariser : <strong>{euros(s.tropPercuCents)}</strong>
                </p>
              )}
              {s.demandesSansMontant > 0 && (
                <p className={styles.detail}>
                  {s.demandesSansMontant} demande{s.demandesSansMontant > 1 ? 's' : ''} réglée
                  {s.demandesSansMontant > 1 ? 's' : ''} sans montant saisi.
                </p>
              )}
              <p className={styles.detail}>
                Renseigné via les versements dans{' '}
                <Link href={`/admin/demandes?rep=${rep.id}`}>les demandes</Link>.
              </p>
            </div>

            {s.chequesMois.length > 0 && (
              <div className={styles.carte}>
                <h3>Chèques à déposer</h3>
                <ul className={styles.liste}>
                  {s.chequesMois.map((mois) => (
                    <li key={mois.label}>
                      <strong>
                        {mois.label} — {euros(mois.total)}
                      </strong>
                      <ul className={styles.liste}>
                        {mois.items.map((it, i) => (
                          <li key={i}>
                            {it.jour} · {it.name} · {euros(it.amountCents)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <p className={styles.detail}>
                  Date de dépôt prévue saisie sur le versement (chèques échelonnés).
                </p>
              </div>
            )}
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
                <span>Acheté</span>
                <span>P. achat</span>
                <span>Vendu</span>
                <span>P. vente</span>
                <span>Recette</span>
                <span>Balance</span>
                <span aria-hidden="true" />
              </div>

              {s.buvette.map((it) => (
                <BuvetteRow key={it.id} item={it} repId={rep.id} />
              ))}

              <form
                action={ajouterBuvetteAction}
                className={`${styles.buvetteLigne} ${styles.buvetteAjout}`}
              >
                <input type="hidden" name="repId" value={rep.id} />
                <input name="label" placeholder="Article (ex. Coca)" maxLength={60} required aria-label="Nouvel article" />
                <input name="qtyStock" type="number" min={0} placeholder="Acheté" aria-label="Quantité achetée" />
                <span className={styles.buvettePrix}>
                  <input name="prixAchat" inputMode="decimal" placeholder="P. achat" aria-label="Prix d'achat en euros" />
                  <span aria-hidden="true">€</span>
                </span>
                <input name="qtySold" type="number" min={0} placeholder="Vendu" aria-label="Quantité vendue" />
                <span className={styles.buvettePrix}>
                  <input name="prix" inputMode="decimal" placeholder="P. vente" aria-label="Prix de vente en euros" />
                  <span aria-hidden="true">€</span>
                </span>
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
                Recette : <strong>{euros(s.buvetteTotaux.recetteCents)}</strong> · Achats :{' '}
                <strong>{euros(s.buvetteTotaux.coutCents)}</strong> · Balance :{' '}
                <strong className={s.buvetteTotaux.balanceCents < 0 ? styles.buvetteNeg : undefined}>
                  {euros(s.buvetteTotaux.balanceCents)}
                </strong>{' '}
                · {s.buvetteTotaux.venduTotal} vendus
              </p>
            )}
          </div>
        </section>
        )
      })}
    </main>
  )
}
