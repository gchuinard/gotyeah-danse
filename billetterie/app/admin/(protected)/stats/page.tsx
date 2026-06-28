// /admin/stats — mini-statistiques par représentation + réconciliation de
// caisse. Tout est calculé à la volée (pas de table dédiée) : remplissage,
// répartition des tailles de groupes, no-shows, et totaux encaissés par mode
// de règlement (saisis au « marquer payée »).

import type { Metadata } from 'next'
import Link from 'next/link'

import { invendusLigne, recetteLigneCents, totauxBuvette } from '@/lib/admin/buvette'
import { euros, placesPayantes, resumePaiement } from '@/lib/admin/money'
import { getTicketPrices } from '@/lib/admin/pricing'
import { MOMENTS, SKY_OPTIONS, parseWeatherReadings } from '@/lib/admin/weather'
import { requireAdmin } from '@/lib/auth/require-admin'
import { prisma } from '@/lib/db'

import { ajouterBuvetteAction, enregistrerBilanAction } from './actions'
import { BuvetteRow } from './buvette-row'
import { BarChart, Jauge, LineChart, type Barre } from './charts'
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
// Clé de tri d'un jour (AAAA-MM-JJ en heure de Paris) — courbe des demandes.
const cleJour = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
// Année (heure de Paris) — regroupement de la vue d'ensemble (1 édition/an).
const anneeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric' })
// Clé de tri d'un mois (AAAA-MM en heure de Paris) indépendante de la locale.
const cleMois = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
})

export default async function StatsPage() {
  await requireAdmin()
  const now = new Date()

  const [representations, totalSieges, prices] = await Promise.all([
    prisma.representation.findMany({ orderBy: { startsAt: 'asc' } }),
    prisma.seat.count(),
    getTicketPrices(prisma),
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
            childCount: true,
            freeSeats: true,
            refundCents: true,
            name: true,
            paidAt: true,
            createdAt: true,
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
      // Découpage tarifaire (places payantes) sur les demandes actives.
      let adultesTotal = 0
      let enfantsTotal = 0
      let offertesTotal = 0
      // Cumul des places demandées par jour (montée des ventes) — demandes actives.
      const placesParJour = new Map<string, number>()

      for (const b of bookings) {
        parStatut.set(b.status, (parStatut.get(b.status) ?? 0) + 1)
        if (['pending', 'paid', 'placed'].includes(b.status)) {
          parTaille.set(b.partySize, (parTaille.get(b.partySize) ?? 0) + 1)
          const pp = placesPayantes(b.partySize, b.childCount, b.freeSeats)
          adultesTotal += pp.adultes
          enfantsTotal += pp.enfants
          offertesTotal += Math.min(Math.max(0, b.freeSeats), b.partySize)
          const jour = cleJour.format(b.createdAt)
          placesParJour.set(jour, (placesParJour.get(jour) ?? 0) + b.partySize)
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
            childCount: b.childCount,
            freeSeats: b.freeSeats,
            adultPriceCents: prices.adultCents,
            childPriceCents: prices.childCents,
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

      // Courbe cumulative des places demandées (jour par jour, chronologique).
      let cumul = 0
      const ventePoints = [...placesParJour.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([jour, places]) => {
          cumul += places
          // jour = "AAAA-MM-JJ" → libellé "JJ/MM".
          const [, m, d] = jour.split('-')
          return { label: `${d}/${m}`, value: cumul }
        })

      // Barres buvette : recette par article (+ stock restant en indice).
      const buvetteBars: Barre[] = buvette
        .map((it) => ({
          label: it.label,
          value: recetteLigneCents(it),
          hint: `${invendusLigne(it)} en stock`,
        }))
        .sort((a, b) => b.value - a.value)

      return {
        rep,
        capacite,
        billets,
        scannes,
        remplissage: capacite > 0 ? Math.round((billets / capacite) * 100) : 0,
        noShows: passee ? billets - scannes : null,
        parStatut,
        parTaille,
        adultesTotal,
        enfantsTotal,
        offertesTotal,
        ventePoints,
        caisse,
        totalRecu,
        rembourseCents,
        totalCaisse,
        resteAEncaisserCents,
        tropPercuCents,
        demandesSansMontant,
        chequesMois: [...chequesParMois.values()],
        buvette,
        buvetteBars,
        buvetteTotaux: totauxBuvette(buvette),
      }
    }),
  )

  // ── Vue d'ensemble : agrégation par ANNÉE (1 édition/an → comparaison
  // d'une année à l'autre). Dérivée des stats par représentation ci-dessus.
  const ACTIFS = ['pending', 'paid', 'placed'] as const
  const parAnneeMap = new Map<
    string,
    {
      annee: string
      reps: number
      capacite: number
      billets: number
      scannes: number
      demandesActives: number
      adultes: number
      enfants: number
      offertes: number
      recetteBillets: number // caisse nette billetterie
      buvetteRecette: number
      buvetteBalance: number
    }
  >()
  for (const s of stats) {
    const annee = anneeFmt.format(s.rep.startsAt)
    const a = parAnneeMap.get(annee) ?? {
      annee,
      reps: 0,
      capacite: 0,
      billets: 0,
      scannes: 0,
      demandesActives: 0,
      adultes: 0,
      enfants: 0,
      offertes: 0,
      recetteBillets: 0,
      buvetteRecette: 0,
      buvetteBalance: 0,
    }
    a.reps += 1
    a.capacite += s.capacite
    a.billets += s.billets
    a.scannes += s.scannes
    a.demandesActives += ACTIFS.reduce((n, st) => n + (s.parStatut.get(st) ?? 0), 0)
    a.adultes += s.adultesTotal
    a.enfants += s.enfantsTotal
    a.offertes += s.offertesTotal
    a.recetteBillets += s.totalCaisse
    a.buvetteRecette += s.buvetteTotaux.recetteCents
    a.buvetteBalance += s.buvetteTotaux.balanceCents
    parAnneeMap.set(annee, a)
  }
  // Années récentes en premier.
  const parAnnee = [...parAnneeMap.values()].sort((x, y) => (x.annee < y.annee ? 1 : -1))
  // Pour les graphes : années en ordre chronologique (gauche → droite).
  const parAnneeChrono = [...parAnnee].reverse()

  return (
    <main className={styles.page}>
      <h1>Statistiques</h1>

      <section className={styles.bloc}>
        <header className={styles.blocHeader}>
          <h2>Vue d’ensemble — comparaison par année</h2>
        </header>
        {parAnnee.length === 0 ? (
          <p className={styles.detail}>Aucune représentation enregistrée.</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.compareTable}>
                <thead>
                  <tr>
                    <th>Année</th>
                    <th>Soirées</th>
                    <th>Billets</th>
                    <th>Remplissage</th>
                    <th>Demandes</th>
                    <th>Adultes</th>
                    <th>Enfants</th>
                    <th>Recette billets</th>
                    <th>Recette buvette</th>
                    <th>Balance buvette</th>
                  </tr>
                </thead>
                <tbody>
                  {parAnnee.map((a) => (
                    <tr key={a.annee}>
                      <td>
                        <strong>{a.annee}</strong>
                      </td>
                      <td>{a.reps}</td>
                      <td>{a.billets}</td>
                      <td>{a.capacite > 0 ? `${Math.round((a.billets / a.capacite) * 100)} %` : '—'}</td>
                      <td>{a.demandesActives}</td>
                      <td>{a.adultes}</td>
                      <td>{a.enfants}</td>
                      <td>{euros(a.recetteBillets)}</td>
                      <td>{euros(a.buvetteRecette)}</td>
                      <td className={a.buvetteBalance < 0 ? styles.buvetteNeg : undefined}>
                        {euros(a.buvetteBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.grille}>
              <div className={styles.carte}>
                <h3>Billets émis par année</h3>
                <BarChart
                  data={parAnneeChrono.map((a) => ({ label: a.annee, value: a.billets, ton: 'a' }))}
                  format={(v) => `${v}`}
                />
              </div>
              <div className={styles.carte}>
                <h3>Recette billetterie par année</h3>
                <BarChart
                  data={parAnneeChrono.map((a) => ({ label: a.annee, value: a.recetteBillets, ton: 'b' }))}
                  format={euros}
                />
              </div>
              <div className={styles.carte}>
                <h3>Recette buvette par année</h3>
                <BarChart
                  data={parAnneeChrono.map((a) => ({ label: a.annee, value: a.buvetteRecette, ton: 'c' }))}
                  format={euros}
                />
              </div>
            </div>
          </>
        )}
      </section>

      <h2 className={styles.sectionTitre}>Détail par représentation</h2>

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
              <Jauge value={s.billets} max={s.capacite} caption="billets émis / sièges actifs" />
              {s.noShows !== null && (
                <>
                  <p className={styles.detail}>
                    Entrées scannées : <strong>{s.scannes}</strong> — no-shows :{' '}
                    <strong>{s.noShows}</strong>
                  </p>
                  <Jauge value={s.scannes} max={s.billets} caption="entrées scannées / billets émis" />
                </>
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
              <h3>Adultes / enfants</h3>
              {s.adultesTotal + s.enfantsTotal + s.offertesTotal === 0 ? (
                <p className={styles.detail}>Aucune place active.</p>
              ) : (
                <BarChart
                  data={[
                    { label: 'Adultes', value: s.adultesTotal, ton: 'a' },
                    { label: 'Enfants', value: s.enfantsTotal, ton: 'c' },
                    ...(s.offertesTotal > 0
                      ? ([{ label: 'Offertes', value: s.offertesTotal, ton: 'b' }] as Barre[])
                      : []),
                  ]}
                  format={(v) => `${v} place${v > 1 ? 's' : ''}`}
                />
              )}
              <p className={styles.detail}>places payantes par tarif (offertes exclues du dû)</p>
            </div>

            <div className={styles.carte}>
              <h3>Demandes dans le temps</h3>
              {s.ventePoints.length === 0 ? (
                <p className={styles.detail}>Aucune demande active.</p>
              ) : (
                <LineChart points={s.ventePoints} format={(v) => `${v} places`} />
              )}
              <p className={styles.detail}>cumul des places demandées, jour par jour</p>
            </div>

            <div className={styles.carte}>
              <h3>Caisse</h3>
              {s.caisse.size === 0 ? (
                <p className={styles.detail}>Aucun versement enregistré.</p>
              ) : (
                <>
                  <BarChart
                    data={[...s.caisse.entries()].map(([methode, ligne]) => ({
                      label: METHODE_LABELS[methode] ?? methode,
                      value: ligne.total,
                      hint: `${ligne.nb} vers.`,
                      ton: methode === 'cheque' ? 'a' : methode === 'especes' ? 'b' : 'c',
                    }))}
                    format={euros}
                  />
                  {s.rembourseCents > 0 && (
                    <p className={styles.detail}>
                      Remboursé : <strong>− {euros(s.rembourseCents)}</strong>
                    </p>
                  )}
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
              <>
                <p className={styles.buvetteTotal}>
                  Recette : <strong>{euros(s.buvetteTotaux.recetteCents)}</strong> · Achats :{' '}
                  <strong>{euros(s.buvetteTotaux.coutCents)}</strong> · Balance :{' '}
                  <strong className={s.buvetteTotaux.balanceCents < 0 ? styles.buvetteNeg : undefined}>
                    {euros(s.buvetteTotaux.balanceCents)}
                  </strong>{' '}
                  · {s.buvetteTotaux.venduTotal} vendus
                </p>
                <div className={styles.buvetteGraph}>
                  <h5 className={styles.buvetteGraphTitre}>Recette par boisson (stock restant en indice)</h5>
                  <BarChart data={s.buvetteBars} format={euros} />
                </div>
              </>
            )}
          </div>
        </section>
        )
      })}
    </main>
  )
}
