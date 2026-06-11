# Billetterie — spectacle de l'école de danse

Billetterie self-hosted pour le spectacle de fin d'année de l'école de danse
Desha-Moulin, au **Centre Culturel de Bergerac** (salle en éventail, 25 rangées
A→Y, 837 places modélisées). Pas de SaaS, pas de commission : un Raspberry Pi 5,
une base SQLite, et c'est tout.

**Principes métier verrouillés** (ne pas les « améliorer ») :

- **Pas de paiement en ligne.** Les familles paient au studio (espèces/chèque) ;
  l'admin marque la demande « payée » à la main.
- Les familles demandent **N places** et **ne choisissent jamais leur siège**.
- Une demande `pending` **consomme la jauge** (un compteur, jamais des sièges
  précis) — la salle ne peut pas être survendue.
- L'attribution des sièges se fait **à la main** au moment du « payé » :
  l'algo propose jusqu'à 3 suggestions, un humain valide toujours.
- **Premier payé, premier placé.**

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
| `ADMIN_EMAILS` | Liste blanche des admins (emails séparés par des virgules) |
| `SESSION_SECRET` | Signature des cookies admin — générer : `openssl rand -hex 32` |

Puis :

```sh
npx prisma migrate dev   # crée prisma/dev.db et applique les migrations
pnpm db:seed             # voir ci-dessous
pnpm dev                 # http://localhost:3000
```

Le seed est **relançable** (upserts, ids déterministes). En dev il crée :

- les **837 sièges calibrés** (générés depuis `config/venue.ts`, scores statiques compris) ;
- **2 représentations** ouvertes (`rep-samedi`, `rep-dimanche`) ;
- **6 demandes de démo** (pending/paid/placed), dont une **placée avec 4 billets**
  (Famille Dupuis, rang R central).

Les demandes de démo sont **gardées par `NODE_ENV !== 'production'`** : en prod,
le seed ne crée que le plan de salle et les représentations.

**Connexion admin** : pas de mot de passe. On saisit son email (qui doit figurer
dans `ADMIN_EMAILS` du `.env`), on reçoit un **code à 6 chiffres** (valable
10 minutes, usage unique) et on le saisit. En dev sans `BREVO_API_KEY`, le code
s'affiche **dans la console du serveur** (`[email dev] code de connexion …`).

> **Note WSL2 / `/mnt/c`** : le watcher de Next ne voit pas les **nouveaux**
> fichiers créés sur le montage Windows. Si une page fraîchement créée renvoie
> 404, relancer `pnpm dev`.

## Visite guidée

| URL | Quoi |
| --- | --- |
| `/` | Formulaire public de demande de places (représentations ouvertes avec jauge > 0) |
| `/billets/<token>` | Suivi d'une demande / billets + QR codes (lien envoyé par email) |
| `/admin` | Dashboard (compteurs par représentation, jauge, scans en live) |
| `/admin/demandes` | File des demandes : marquer payée, prolonger, annuler |
| `/admin/placement/<bookingId>` | Suggestions de placement + ajustement manuel, émission des billets |
| `/admin/plan` | Plan de salle interactif + **blocage de sièges** (console, fosse, amovibles) |
| `/admin/scan` | Scan des billets le soir J (caméra + saisie manuelle) |
| `/admin/calibration` | Superposition plan généré / scan de la fiche technique |

Deux tokens de démo pratiques (seed dev) :

- `/billets/f6a8c0e2-4b6d-4f8a-9c1e-3d5f7a9b1c3e` — demande **placée**, 4 billets avec QR ;
- `/billets/5f1e7c1a-9b3d-4e6f-8a2c-0d4b6e8f1a3c` — demande **pending** (page d'attente).

Le flux complet : une famille fait une **demande** sur `/` (email de confirmation
avec lien de suivi) → elle paie au studio, l'admin la marque **payée** → l'admin
ouvre le **placement** (3 suggestions de l'algo, ajustables siège par siège),
valide → les **billets + QR** partent par email → le soir, **scan** à l'entrée.

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
AVANT les ventes, jamais après). Numérotation **pair-impair** confirmée sur la
fiche : face à la scène, impairs côté cour (droite), pairs côté jardin,
croissants depuis l'axe central.

**Lettrage des rangs** (confirmé Gautier, 2026-06-11) : la salle est numérotée
**A (tout au fond) → Y (collé à la scène)**, en 3 blocs — bloc « haute » A→G
(fond), bloc « normale » H→W (milieu), fosse amovible X/Y (scène). Le tableau
`rows` de `venue.ts` est ordonné scène→fond (rowOrder 0 = Y) ; le score statique
dépend du rang **physique** depuis la scène, pas de la lettre.

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

**Admins** : aucun compte à créer. La liste blanche `ADMIN_EMAILS` de
`.env.production` fait foi — chaque bénévole se connecte avec son email et le
code à 6 chiffres reçu via Brevo. Ajouter/retirer un bénévole = éditer la
variable puis `docker compose up -d`. ⚠️ La clé Brevo est donc indispensable
pour se connecter en production (et chaque admin doit se connecter **avant** le
soir du spectacle — la session dure 7 jours).

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
  public), supprimer (bloqué dès qu'une demande existe, même annulée).

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
| `ADMIN_EMAILS` | liste blanche admins | idem — **obligatoire** (login par code email) |
| `SESSION_SECRET` | `openssl rand -hex 32` | idem — **obligatoire** |
| `BREVO_API_KEY` | optionnel (emails + codes → console) | **requis** (sinon aucun email ne part, login impossible) |
| `EMAIL_SENDER_NAME` / `EMAIL_SENDER_ADDRESS` | expéditeur | idem |
| `PLACEMENT_IMPL` | `baseline` (défaut) \| `custom` | idem |
| `NODE_ENV` | — | `production` (coupe la démo du seed) |

Documents liés : [PLACEMENT.md](PLACEMENT.md) (spec de l'algo),
[docs/revue-securite.md](docs/revue-securite.md) (revue du 2026-06-10,
correctifs C1-C3/C5 appliqués).
