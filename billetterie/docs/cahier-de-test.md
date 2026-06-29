# Cahier de test E2E — Billetterie

Plan de tests **bout en bout** (parcours UI réels, via Playwright). Il **complète**
les tests unitaires/intégration vitest (placement, montants, versements,
transactions, codes…) — il ne les double pas : ici on teste les **flux à travers
l'interface**, c'est-à-dire ce que vitest ne voit pas (server actions, rendu,
navigation, état client).

> Statut : **cahier validé / à coder**. Aucun test Playwright n'existe encore —
> ce document fixe le périmètre avant la mise en place.

## Conventions

Chaque cas : **ID**, titre, **Préconditions**, **Étapes**, **Résultat attendu**.
Priorités : **P1** = critique le soir du spectacle ou cœur d'une feature ·
**P2** = parcours important · **P3** = confort / cosmétique.

## Environnement de test

- **Base jetable** : SQLite dédiée (`DATABASE_URL` de test), **seedée** avant la
  run via `pnpm db:seed` (`NODE_ENV !== 'production'` → plan 754 sièges, 2
  représentations ouvertes `rep-samedi` / `rep-dimanche`, 6 demandes démo dont
  **une placée à 4 billets**). Jamais `prisma/dev.db`.
- **Auth admin** : pas de passage par l'OTP Brevo. Un *global-setup* **forge le
  cookie de session signé** (`lib/auth/session.ts` + `SESSION_SECRET`) et le
  sauve en `storageState`, **un par rôle** : `super-admin`, `admin`, `scan`.
- **Externes neutralisés** (déjà le cas en dev) : Brevo sans clé → emails en
  console ; Turnstile sans secret → CAPTCHA désactivé.
- **Scan** : testé par la **saisie manuelle** (la caméra n'est pas pilotée).
- **Partage** : `navigator.share` **n'existe pas** en Chromium headless → c'est
  le **repli presse-papier / lien** qui est vérifié (permission clipboard
  accordée au contexte de test).
- **Tarifs** : un cas P1 suppose des **tarifs adulte/enfant** définis (seed ou
  `/admin/representations`) pour vérifier les montants.

Tokens démo utiles (seed dev) :
- placée, 4 billets : `/billets/f6a8c0e2-4b6d-4f8a-9c1e-3d5f7a9b1c3e`
- en attente : `/billets/5f1e7c1a-9b3d-4e6f-8a2c-0d4b6e8f1a3c`

---

## PUB — Formulaire public de demande

- **PUB-01 (P1) — Demande nominale.**
  Préc : `rep-samedi` ouverte, jauge > 0.
  Étapes : `/` → remplir prénom, nom, email, téléphone, nombre de places, « dont
  enfants » → soumettre.
  Attendu : redirection `/billets/<token>` ; titre « Demande enregistrée » ;
  **identifiant de demande** affiché ; **montant indicatif** affiché (ventilé
  adultes/enfants si tarifs définis) ; email de confirmation loggé en console.

- **PUB-02 (P2) — Montant indicatif réactif.**
  Étapes : changer le nombre de places et « dont enfants ».
  Attendu : le montant ventilé se recalcule en direct, places offertes exclues.

- **PUB-03 (P2) — Validation des champs.**
  Étapes : email invalide / champs requis vides → soumettre.
  Attendu : erreurs par champ, **aucune demande créée**, pas de redirection.

- **PUB-04 (P2) — Jauge épuisée.**
  Préc : représentation à jauge 0.
  Attendu : elle **n'apparaît pas** dans le formulaire (ou demande refusée).

- **PUB-05 (P3) — Mise en page 2 colonnes.**
  Attendu : ≥ 920 px, formulaire à gauche + **FAQ** à droite ; < 920 px, empilé.

## ACC — Accès « j'ai déjà une demande »

- **ACC-01 (P2) — Accès correct.**
  Étapes : onglet Accès → email + identifiant valides.
  Attendu : redirection vers `/billets/<token>` de la demande.

- **ACC-02 (P2) — Identifiant erroné.**
  Attendu : message **générique** (pas de distinction email connu/inconnu), pas
  d'accès.

- **ACC-03 (P3) — Identifiant oublié.**
  Attendu : message générique « si une demande existe, identifiant renvoyé ».

## ADM — Demandes & paiement (admin)

- **ADM-01 (P2) — Liste + filtres.**
  Préc : session `admin`.
  Étapes : `/admin/demandes` → filtrer par statut, par paiement, recherche
  nom/email/tél.
  Attendu : la liste se restreint correctement (live).

- **ADM-02 (P1) — Versement → soldé.**
  Préc : demande en attente avec montant dû connu, tarifs définis.
  Étapes : ouvrir la popup → ajouter un versement espèces = reste dû.
  Attendu : chip **✓ Soldé**, récap dû/reçu/reste cohérent, statut `paid`.

- **ADM-03 (P1) — Acompte puis solde.**
  Étapes : versement partiel → second versement.
  Attendu : chip **⏳ Acompte** après le 1ᵉʳ, **✓ Soldé** après le 2ᵉ.

- **ADM-04 (P2) — Remboursement.**
  Étapes : bloc Remboursement → montant + motif.
  Attendu : chip **↩ Remboursé**, **net** recalculé (Σ versements − remboursé).

- **ADM-05 (P2) — Places offertes.**
  Étapes : définir N places offertes.
  Attendu : montant dû recalculé, **déduites des enfants d'abord** puis adultes.

- **ADM-06 (P2) — Création admin + doublons.**
  Étapes : `/admin/demandes/nouvelle` avec un email déjà utilisé sur la rep.
  Attendu : **blocage** + lien vers la demande existante. Avec un tél/nom déjà
  vus : **avertissement** « êtes-vous sûr ? ».

- **ADM-07 (P2) — Rectifier le nombre de places.**
  Attendu : pending/paid → MAJ directe (vérif jauge si hausse) ; **placed** →
  billets supprimés, retour `paid`, redirection placement.

## PLA — Placement

- **PLA-01 (P1) — Suggestions.**
  Préc : demande `paid` non placée.
  Étapes : `/admin/placement/<bookingId>`.
  Attendu : jusqu'à **3 suggestions**, **même rangée d'abord** ; chaque
  suggestion = `partySize` sièges contigus.

- **PLA-02 (P1) — Valider → billets émis.**
  Étapes : valider la 1ʳᵉ suggestion.
  Attendu : demande `placed`, **billets/QR créés**, redirection, sièges occupés
  sur le plan.

- **PLA-03 (P2) — Plafond de sélection.**
  Étapes : sélection manuelle au-delà de `partySize`.
  Attendu : **impossible** de dépasser ; désélectionner libère ; sièges non
  sélectionnés non cliquables au plafond.

- **PLA-04 (P2) — Déplacement.**
  Étapes : redéplacer une demande placée.
  Attendu : **places actuelles pré-sélectionnées** ; bouton **« Annuler le
  déplacement »** revient sans rien changer.

## SCAN — Soir J (saisie manuelle)

- **SCAN-01 (P1) — Chargement du manifeste.**
  Préc : session `scan` (ou admin), `rep` avec billets.
  Étapes : `/admin/scan?rep=…`.
  Attendu : compteur « **0 scannés / N billets** », synchro « à jour ».

- **SCAN-02 (P1) — Marquer scanné.**
  Étapes : recherche par nom → résultat → « Marquer scanné ».
  Attendu : panneau **vert** (nom + place), compteur **+1**.

- **SCAN-03 (P1) — Doublon en mode souple (défaut).**
  Étapes : re-scanner le même billet.
  Attendu : panneau **teal « Laissez entrer »** + « Déjà passé à HH:MM » ;
  compteur **inchangé** ; pas d'alerte.

- **SCAN-04 (P1) — Doublon en mode strict.**
  Étapes : cocher **« Contrôle strict des doublons »** → re-scanner.
  Attendu : panneau **ambre « Déjà scanné à HH:MM »** (alerte).

- **SCAN-05 (P2) — Indice « non scannable ici ».**
  Étapes : chercher une personne placée sur **l'autre date** (ou non placée).
  Attendu : « Aucun billet à scanner ici » + **indice** expliquant pourquoi.

- **SCAN-06 (P3) — Recherche par place.**
  Étapes : critère « Place » → « R12 ».
  Attendu : le billet du siège R12 remonte.

## PART — Partage d'une place

- **PART-01 (P1) — Codes visibles.**
  Préc : demande **placée** (token démo).
  Étapes : `/billets/<token-placé>`.
  Attendu : sous chaque place, **code** au format `XX####` (2 lettres + 4
  chiffres) + boutons **Copier** / **Partager** (bloc absent à l'impression).

- **PART-02 (P1) — Copier le code.**
  Étapes : cliquer **Copier**.
  Attendu : presse-papier = le code ; toast **« Code copié ✓ »**.

- **PART-03 (P1) — Menu Partager (repli desktop).**
  Étapes : cliquer **Partager** → menu → « Copier le lien ».
  Attendu : menu **WhatsApp / SMS / E-mail / Copier le lien** ; presse-papier
  contient l'URL **`/place/<qrToken>`** ; toast **« Lien copié ✓ »**.

- **PART-04 (P1) — `/place` par email + code.**
  Étapes : `/place` → email de la résa placée + le code de PART-01.
  Attendu : vue **lecture seule** : section/rang/place + QR + « **groupe de … »**,
  **aucune action**, aucune donnée perso.

- **PART-05 (P1) — Cadrage par email.**
  Étapes : bon code mais **autre email**.
  Attendu : « Email ou code incorrect » — **jamais** la place d'un inconnu.

- **PART-06 (P2) — Chiffre de contrôle.**
  Étapes : code avec un chiffre faux.
  Attendu : « code incorrect » (rejeté).

- **PART-07 (P1) — Lien direct.**
  Étapes : ouvrir `/place/<qrToken>` (vrai) puis `/place/<bidon>`.
  Attendu : vrai → vue lecture seule directe ; bidon → **404**.

## STAT — Statistiques

- **STAT-01 (P2) — Chargement.**
  Étapes : `/admin/stats`.
  Attendu : **comparaison par année** + blocs par représentation **repliables**
  (pliés par défaut), graphes rendus sans erreur.

- **STAT-02 (P2) — Réconciliation de caisse.**
  Préc : après ADM-02/03.
  Attendu : net = Σ versements − remboursé ; reste à encaisser / trop-perçu
  cohérents avec les versements saisis.

- **STAT-03 (P3) — Info-bulle de la courbe.**
  Étapes : survoler la courbe des demandes.
  Attendu : bulle avec valeur + date (peut être fragile en E2E → P3).

## SEC — Rôles & accès (léger)

- **SEC-01 (P1) — Garde admin.**
  Étapes : `/admin/demandes` **sans session**.
  Attendu : redirection vers `/admin/login`.

- **SEC-02 (P2) — Rôle `admin` restreint.**
  Attendu : pas d'accès à calibration / salles / représentations / comptes (nav
  filtrée **et** route qui re-vérifie → redirection/refus en accès direct).

- **SEC-03 (P2) — Rôle `scan`.**
  Attendu : accès **uniquement** à la page scan.

---

## Hors périmètre (pour mémoire)

- **Caméra de scan** : non pilotée (chemin manuel couvre la logique).
- **Feuille de partage native** (`navigator.share`) : indisponible en headless.
- **Site statique `desha-moulin`** : HTML quasi sans logique → faible valeur
  E2E ; au plus un *smoke* (nav, menu burger, FAQ) si besoin un jour.
- **Anti-bot** (honeypot, time-trap, Turnstile) : couvert en unitaire / désactivé
  en dev — pas un parcours E2E.

## Lots de mise en œuvre

1. **Socle** : `playwright.config.ts` + `webServer` sur base de test seedée +
   *global-setup* qui forge les `storageState` par rôle. (le gros du travail)
2. **P1 d'abord** : PART-*, ADM-02/03, PLA-01/02, SCAN-01→04, SEC-01, PUB-01.
3. **P2 puis P3** au fil de l'eau.
