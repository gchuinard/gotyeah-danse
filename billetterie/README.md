# Billetterie — spectacle de l'école de danse

Billetterie self-hosted pour le spectacle de fin d'année de l'école de danse
Desha-Moulin, au **Centre Culturel de Bergerac** (salle en éventail, 25 rangées
A→Y, 754 places modélisées). Pas de SaaS, pas de commission : un Raspberry Pi 5,
une base SQLite, et c'est tout.

**Principes métier verrouillés** (ne pas les « améliorer ») :

- **Pas de paiement en ligne.** Les familles paient au studio (espèces/chèque) ;
  l'admin marque la demande « payée » à la main.
- Les familles demandent **N places** et **ne choisissent jamais leur siège**.
- Une demande `pending` **consomme la jauge** (un compteur, jamais des sièges
  précis) — la salle ne peut pas être survendue.
- L'attribution des sièges se fait **à la main** : l'algo propose jusqu'à
  3 suggestions, un humain valide toujours.
- **Placement et paiement sont indépendants.** On peut placer une demande
  avant qu'elle soit payée (« placer maintenant, payer plus tard ») et
  enregistrer le règlement après coup. Une demande placée **non réglée**
  n'envoie PAS ses billets automatiquement : l'admin le déclenche à la main
  (avec avertissement). Pratique recommandée : premier payé, premier placé —
  mais ce n'est plus imposé.
- **Prix unique et montant dû.** Un **prix unitaire global** (réglé dans
  `/admin/representations`, rangé dans `Setting`) donne le **montant dû** de
  chaque demande = (places − **places offertes**) × prix. Les places offertes
  (ex. tout-petits qui dansent) se fixent par demande.
- **Versements multiples.** Le règlement est une suite de **versements**
  (espèces / chèques), pas un montant unique : on gère les **chèques échelonnés**
  (montant + **date de dépôt** prévue). Une demande est **soldée** quand le net
  (Σ versements − remboursé) atteint le dû ; sinon c'est un **acompte**. La
  caisse compte un chèque **dès sa remise** (la date de dépôt n'est qu'une aide
  à l'échelonnement).

Stack : Next.js 16 (App Router) · Prisma 6 / SQLite · TypeScript · Docker sur Pi 5 ARM64.

## Démarrage local

Prérequis : Node 24+, pnpm via corepack (`corepack enable` — la version est
épinglée dans `package.json`).

```sh
pnpm install
cp .env.example .env
```

Dans `.env` :

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | SQLite, chemin relatif à `prisma/schema.prisma` (`file:./dev.db`) |
| `APP_BASE_URL` | URL publique, utilisée dans les liens des emails |
| `BREVO_API_KEY` | Sans clé, les emails sont simplement loggés en console (parfait en dev) |
| `EMAIL_SENDER_NAME` / `EMAIL_SENDER_ADDRESS` | Expéditeur des emails |
| `PLACEMENT_IMPL` | `baseline` (défaut) ou `custom` |
| `VENUE_ID` | Salle active : charge `config/venues/<id>.json` (défaut : Bergerac intégré) |
| `ADMIN_EMAILS` | **Super-admins « garantis »** (anti-lockout), emails séparés par des virgules. Les autres comptes se gèrent dans `/admin/comptes` |
| `SESSION_SECRET` | Signature des cookies admin — générer : `openssl rand -hex 32` |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile (anti-bot du formulaire public). **Sans la clé secrète, le CAPTCHA est désactivé** (parfait en dev) |

Puis :

```sh
npx prisma migrate dev   # crée prisma/dev.db et applique les migrations
pnpm db:seed             # voir ci-dessous
pnpm dev                 # http://localhost:3000
```

Le seed est **relançable** (upserts, ids déterministes). En dev il crée :

- les **754 sièges calibrés** (générés depuis `config/venue.ts`, scores statiques compris) ;
- **2 représentations** ouvertes (`rep-samedi`, `rep-dimanche`) ;
- **6 demandes de démo** (pending/paid/placed), dont une **placée avec 4 billets**
  (Famille Dupuis, rang R central).

Les demandes de démo sont **gardées par `NODE_ENV !== 'production'`** : en prod,
le seed ne crée que le plan de salle et les représentations.

**Connexion** : pas de mot de passe. Deux modes sur `/admin/login` (onglets) :

- **Admin / super-admin** : on saisit son email (autorisé via `ADMIN_EMAILS` du
  `.env` **ou** un compte créé dans `/admin/comptes`), on reçoit un **code à
  6 chiffres** (valable 10 minutes, usage unique) qu'on saisit **case par
  case**. En dev sans `BREVO_API_KEY`, le code s'affiche **dans la console du
  serveur** (`[email dev] code de connexion …`).
- **Bénévole · scan** : **prénom + PIN partagé** (défini dans `/admin/comptes`).
  Donne accès **uniquement** à la page de scan ; le prénom trace qui a scanné
  (`Ticket.scannedBy`).

**Trois rôles** : `super-admin` (tout) · `admin` (tout **sauf** calibration,
salles, représentations, comptes) · `scan` (uniquement la page scan). La
navigation est filtrée selon le rôle ; chaque page/action/route le re-vérifie
(défense en profondeur, cf. `lib/auth/roles.ts` + `lib/auth/require-admin.ts`).

> **Note WSL2 / `/mnt/c`** : le watcher de Next ne voit pas les **nouveaux**
> fichiers créés sur le montage Windows. Si une page fraîchement créée renvoie
> 404, relancer `pnpm dev`.

## Visite guidée

| URL | Quoi |
| --- | --- |
| `/` | Formulaire public de demande de places (représentations ouvertes avec jauge > 0) |
| `/billets/<token>` | Suivi d'une demande / billets + QR codes (lien envoyé par email) |
| `/admin` | Dashboard (compteurs par représentation, jauge, scans en live) |
| `/admin/demandes` | File des demandes (liste épurée). **Clic sur une ligne → popup « centre d'actions »** : détail, **historique**, note modifiable, **récap dû / reçu / reste**, et toutes les actions — **ajouter un versement** (montant pré-rempli = reste dû, date de dépôt + n° pour chèques) / supprimer un versement / **annuler tout le règlement** / **remboursement** (montant + motif), **places offertes**, rectifier le nombre de places, prolonger, **remise e-billet ⇄ papier**, envoyer/imprimer les billets, annuler. Chip de paiement : ✗ Non payé / ⏳ Acompte / ✓ Soldé / ↩ Remboursé. La liste ne garde que le raccourci **Placer/Déplacer**. Un **rappel** s'affiche si les places ont changé après le paiement. |
| `/admin/placement/<bookingId>` | Suggestions de placement + ajustement manuel, émission des billets |
| `/admin/plan` | Plan de salle interactif (zoom/déplacement, lettres de rangs, numéros) + **blocage de sièges** + bascule **fixe ↔ amovible** (⚠️ ré-initialisée par un re-seed) |
| `/admin/scan` | Scan des billets le soir J (caméra + saisie manuelle) |
| `/admin/stats` | Mini-stats par représentation + **réconciliation de caisse** (par mode, **net = Σ versements − remboursé**, reste à encaisser, trop-perçu) + **« Chèques à déposer »** groupés par mois + **bilan d'organisation** (météo, buvette proposé/vendu/prix, notes pour l'an prochain) |
| `/admin/calibration` | Superposition plan généré / scan de la fiche technique |
| `/admin/salles/nouvelle` | **Créer une salle** : relevé en notation compacte + aperçu live → JSON multi-salles |
| `/admin/comptes` | **(super-admin)** Gérer les comptes admin (ajout / rôle / suppression) + le **PIN du mode scan** |

Deux tokens de démo pratiques (seed dev) :

- `/billets/f6a8c0e2-4b6d-4f8a-9c1e-3d5f7a9b1c3e` — demande **placée**, 4 billets avec QR ;
- `/billets/5f1e7c1a-9b3d-4e6f-8a2c-0d4b6e8f1a3c` — demande **pending** (page d'attente).

Le flux complet : une famille fait une **demande** sur `/` (email de confirmation
avec lien de suivi, **montant indicatif** affiché) → elle paie au studio, l'admin
enregistre un ou plusieurs **versements** (espèces/chèques, montant pré-rempli =
reste dû ; chèques échelonnables avec date de dépôt — alimentent la caisse de
`/admin/stats`) → l'admin ouvre le **placement** (3 suggestions de l'algo, ajustables siège par
siège), valide → les **billets + QR** partent par email (sur téléphone, un tap
sur le QR l'affiche **plein écran** pour le scan) → le soir, **scan** à l'entrée.
Paiement et placement étant **indépendants**, l'admin peut aussi **placer avant
le paiement** (bouton « Placer » sur une demande en attente) : la demande devient
*placée non réglée* (chip ⚠ dans la liste), ses billets ne partent pas tout
seuls, et le règlement s'enregistre plus tard via « Marquer payée ». L'admin
envoie alors les billets à la main (« Envoyer les billets », avec avertissement
si rien n'est encore réglé). La **remise** se choisit par demande : **e-billet**
(email + QR) ou **papier** (le QR reste le même, scanné pareil à l'entrée, mais
aucun email n'est envoyé — l'admin imprime via « Imprimer les billets », qui
ouvre la page imprimable des billets). Chaque demande peut porter une **note
interne**
bénévole (n° de chèque, contexte) visible uniquement dans l'admin et dans
l'export CSV.

## L'algorithme de placement

La baseline (`lib/placement/baseline.ts`) est **volontairement naïve** : première
fenêtre libre depuis la scène (rangs Y/X). `lib/placement/custom.ts` est le terrain de jeu
du dev : passer `implemented` à `true`, activer avec `PLACEMENT_IMPL=custom`.
Le harnais : `pnpm test` (5 invariants) et le simulateur Monte Carlo seedé,
`pnpm simulate --impl=baseline --runs=200 --seed=42` vs `--impl=custom` — même
seed, mêmes soirées de vente, comparaison à conditions identiques. Spec
complète, contrat et vocabulaire : **[PLACEMENT.md](PLACEMENT.md)**.

## Calibration de la salle

Tout le plan (seed, rendu SVG, calibration) est généré depuis
**`config/venue.ts`** — rien n'est hardcodé ailleurs. Les unités sont les
**pixels du scan** de la fiche technique (`public/plan-scan.png`, 1848×2612) :
l'overlay de `/admin/calibration` superpose le plan généré au scan et s'aligne
avec les réglages par défaut. Pour vérifier sans navigateur :

```sh
npx tsx scripts/calibration-composite.ts   # écrit /tmp/composite-full.png
```

Après toute modification de `config/venue.ts`, **relancer `pnpm db:seed`**
(les sièges/rangées orphelins sont supprimés, les scores ré-écrits — à faire
AVANT les ventes, jamais après). Numérotation **pair-impair** (sens confirmé
Gautier 2026-06-11) : **impairs côté jardin** (où est la terrasse PMR
« accessible »), **pairs côté cour**, croissants depuis l'axe central.

**Lettrage des rangs** (confirmé Gautier, 2026-06-11) : la salle est numérotée
**A (tout au fond) → Y (collé à la scène)**, en 3 blocs — bloc « haute » A→G
(fond), bloc « normale » H→W (milieu), fosse amovible X/Y (scène). Le tableau
`rows` de `venue.ts` est ordonné scène→fond (rowOrder 0 = Y) ; le score statique
dépend du rang **physique** depuis la scène, pas de la lettre.

**Sauts de numérotation** : la salle réelle saute des numéros (ex. rang O,
pairs 12 puis 16 — pas de 14). `ArcConfig.firstNumber` (numéro du siège de
l'arc le plus proche de l'axe) les reproduit ; vérifié par
`tests/venue/numbering.test.ts` contre le relevé `place.md` (qui fait foi).

## Multi-salles & créateur de salle

Les salles vivent **en base** (table `Venue`) et se gèrent depuis l'admin —
**sans reseed ni rebuild** :

1. **`/admin/salles/nouvelle`** : l'ÉDITEUR DE RANGS — une ligne par rang
   (mini-barre, total, sauts), qui se déplie pour éditer ses blocs (sièges,
   1ᵉʳ n° pour les sauts, amovible, séparé, « + bloc » pour strapontins et
   consoles partielles). La notation compacte reste la couche experte (ligne
   éditable par rang + import/export) ; « | » y marque une séparation
   explicite. Aperçu live, puis **« Enregistrer dans la billetterie »** ;
   chaque salle se **rouvre** ensuite via « Modifier » (la config est
   re-sérialisée en relevé) ;
2. **`/admin/salles`** : **Activer** la salle — le plan (Section/Row/Seat) est
   synchronisé immédiatement par `lib/venue/sync.ts`. Garde-fous : refus si
   des billets existent sur des sièges qui disparaîtraient ; les bascules
   fixe ↔ amovible faites sur le plan sont conservées. À faire AVANT les
   ventes. « Réappliquer le plan » re-synchronise la salle active après une
   modification ; « Revenir à la salle par défaut » restaure VENUE_ID/intégrée.

Résolution de la salle active (`loadActiveVenueConfig`) : salle activée en
base → fichier `config/venues/<VENUE_ID>.json` (zod) → Bergerac intégré.
`pnpm db:seed` utilise la même synchro et la même résolution. Le bouton
« Télécharger le JSON » du créateur reste là pour la sauvegarde fichier.

La géométrie générée est régulière (rayons/allées uniformes) : fidèle pour la
numérotation et la contiguïté du placement, indicative pour le dessin. Les
outils de calibration (overlay scan) restent sur la config fichier/intégrée.

## Tests & simulateur

```sh
pnpm test       # vitest : invariants de placement, transactions bookings, crons
pnpm simulate   # Monte Carlo, voir PLACEMENT.md
```

Les tests qui touchent la base utilisent des **DB SQLite jetables dans `/tmp`**
(URL passée explicitement) — `prisma/dev.db` n'est jamais touchée.

## Déploiement sur le Raspberry Pi 5

L'app tourne en Docker derrière Nginx Proxy Manager (NPM) + Cloudflare, sur
`https://billets.cours-danse-bergerac.fr`.

```sh
git clone <repo> && cd gotyeah-danse/billetterie
cp .env.production.example .env.production
# remplir : SESSION_SECRET (openssl rand -hex 32), BREVO_API_KEY, ADMIN_EMAILS,
#           APP_BASE_URL=https://billets.cours-danse-bergerac.fr
docker compose up -d --build
```

Le build est **natif ARM64 sur le Pi**. Pour builder depuis un PC x64 :
décommenter `platform: linux/arm64` dans `docker-compose.yml`, ou
`docker buildx build --platform linux/arm64 -t billetterie .`

Ce que ça déploie :

- **2 services, même image** : `web` (Next sur `127.0.0.1:3000`, loopback
  uniquement — c'est NPM qui expose) et `cron` (daemon quotidien à 9h00,
  Europe/Paris) ;
- l'**entrypoint** (`docker/entrypoint.sh`) lance `prisma migrate deploy` au
  démarrage des deux services — idempotent, la base est toujours à jour ;
- la base SQLite vit sur le volume **`billetterie-data`** monté en `/data`
  (`DATABASE_URL=file:/data/prod.db`).

Sauvegarde simple de la base :

```sh
docker compose cp web:/data/prod.db ./backup-$(date +%F).db
```

(Suffisant pour ce volume d'écritures ; pour un snapshot garanti cohérent,
faire la copie à un moment calme ou via `sqlite3 prod.db ".backup ..."` si
sqlite3 est installé sur l'hôte.)

**Admins & rôles** : `ADMIN_EMAILS` de `.env.production` = les **super-admins
garantis** (anti-lockout, modifiables uniquement par `docker compose up -d`).
Tous les autres comptes (`admin` / `super-admin`) **et le PIN du mode scan** se
gèrent ensuite dans **`/admin/comptes`**, sans redeploy. Chaque admin se
connecte avec son email + le code à 6 chiffres reçu via Brevo ; les bénévoles
scan avec prénom + PIN. ⚠️ La clé Brevo est indispensable pour le login admin
en production (et chaque admin doit se connecter **avant** le soir du spectacle
— la session dure 7 jours). Le PIN scan, lui, ne dépend pas de Brevo.

Initialiser le plan de salle et les représentations en prod (une fois) :

```sh
docker compose exec web pnpm db:seed
```

Côté réseau :

- **NPM** : proxy host `billets.cours-danse-bergerac.fr` → `127.0.0.1:3000`.
  Pas de websockets nécessaires.
- **Cloudflare** : DNS + TLS devant NPM.
- **3 recos amont de la revue de sécurité** (voir
  [docs/revue-securite.md](docs/revue-securite.md), §5) :
  1. NPM doit **écraser** `X-Forwarded-For` avec l'IP réelle (`real_ip_header
     CF-Connecting-IP` + plages Cloudflare en `set_real_ip_from`), sinon le
     rate-limit applicatif est contournable ;
  2. règle de **rate-limit Cloudflare** sur `/admin/login` et le `POST` du
     formulaire public ;
  3. vérifier que **HSTS** est émis (max-age ≥ 6 mois).

## Exploitation le soir J

Checklist :

1. **Vérifier les blocages de sièges** sur `/admin/plan` pour la représentation
   du soir : console son, fosse/avant-scène, segments amovibles non posés.
2. **Ouvrir `/admin/scan` sur les téléphones des bénévoles** AVANT de partir :
   HTTPS obligatoire pour la caméra, et il faut être connecté — la session
   admin dure **7 jours**, donc se logger la veille suffit.
3. Le scan **fonctionne sans réseau** : le manifeste des billets est chargé au
   départ, la validation est 100 % locale, les scans rejoignent une file de
   synchro (miroir localStorage — **survit au refresh**) envoyée dès que le
   réseau revient.
4. **Saisie manuelle en secours** : recherche par nom partiel ou par place
   (« G12 »), directement sur la page de scan.
5. **Premier scan gagne** : un billet déjà scanné est refusé, impossible de le
   « dé-scanner » par la route.
6. Le **dashboard** (`/admin`) suit les compteurs de scan en live.

## Tâches récurrentes

- **Crons** (service `cron` en prod, automatique à 9h00) : relance email **J+7**
  des demandes non payées, expiration **J+14**. À la main : `pnpm cron --once`
  (idempotent, relançable sans double envoi).
- **Export CSV** d'une représentation : bouton dans l'admin
  (`/api/admin/export/<repId>`).
- **Gérer les représentations** : `/admin/representations` — créer (fermée par
  défaut), modifier titre et date/heure (saisies en heure de Paris), **ouvrir/
  fermer les réservations** (une représentation fermée disparaît du formulaire
  public), supprimer (bloqué dès qu'une demande existe, même annulée). C'est
  aussi là qu'on fixe le **prix unitaire** d'une place (carte « Tarif »,
  super-admin — champ vide = prix effacé). À faire **avant les ventes**.

## Référence rapide

### Scripts pnpm

| Commande | Quoi |
| --- | --- |
| `pnpm dev` | Serveur de dev Next (port 3000) |
| `pnpm build` / `pnpm start` | Build et serveur de prod |
| `pnpm lint` | ESLint |
| `pnpm test` | Tests vitest (DB jetables dans /tmp) |
| `pnpm simulate [--impl=… --runs=… --seed=…]` | Simulateur Monte Carlo de placement |
| `pnpm cron [--once]` | Daemon des tâches planifiées (ou un passage immédiat) |
| `pnpm db:seed` | Seed (plan + représentations ; + démo hors prod) |

### Variables d'environnement

| Variable | Dev (`.env`) | Prod (`.env.production`) |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | `file:/data/prod.db` (volume Docker) |
| `APP_BASE_URL` | `http://localhost:3000` | `https://billets.cours-danse-bergerac.fr` |
| `ADMIN_EMAILS` | super-admins garantis | idem — **obligatoire** (au moins un, anti-lockout) |
| `SESSION_SECRET` | `openssl rand -hex 32` | idem — **obligatoire** |
| `BREVO_API_KEY` | optionnel (emails + codes → console) | **requis** (sinon aucun email ne part, login impossible) |
| `EMAIL_SENDER_NAME` / `EMAIL_SENDER_ADDRESS` | expéditeur | idem |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | optionnel (CAPTCHA désactivé) | recommandé (anti-bot du formulaire public) |
| `PLACEMENT_IMPL` | `baseline` (défaut) \| `custom` | idem |
| `VENUE_ID` | optionnel — salle JSON de `config/venues/` | idem (re-seeder après changement) |
| `NODE_ENV` | — | `production` (coupe la démo du seed) |

Documents liés : [PLACEMENT.md](PLACEMENT.md) (spec de l'algo),
[docs/revue-securite.md](docs/revue-securite.md) (revue du 2026-06-10,
correctifs C1-C3/C5 appliqués).
