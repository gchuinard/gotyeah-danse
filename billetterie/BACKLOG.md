# Backlog

Idées et corrections en attente, notées au fil de l'eau (2026-06-11).
Aucun engagement d'ordre — prioriser à la demande.

## ✅ Fait le 2026-06-29 (tarifs enfant + stats + placement)

- [x] **Tarifs adulte / enfant.** Le prix unique global devient **deux tarifs
  globaux** (Setting `ticket_price_adult_cents` / `ticket_price_child_cents` ;
  l'ancien `ticket_price_cents` lu en repli comme tarif adulte). `Booking.childCount`
  (migration `add_child_count`) ; adultes = partySize − childCount. Montant dû =
  adultes×prixA + enfantsPayants×prixE, **places offertes déduites des enfants
  d'abord**. Déclaré sur le **formulaire public** (sélecteur « dont enfants » +
  montant indicatif ventilé), ajustable en admin (popup). Diffusé partout
  (liste, popup, caisse, export CSV colonnes Adultes/Enfants, page famille).
  Calcul dans `lib/admin/money.ts` (`montantDuCents`/`resumePaiement`/`placesPayantes`).
- [x] **Placement — « même rangée d'abord ».** La sélection propose d'abord des
  **fenêtres** (groupe sur une rangée) sur des rangées **distinctes** ; les
  **blocs** (remplissage vertical) ne viennent qu'« le cas échéant ». Quand un
  bloc est nécessaire, l'anti-orphelin y est **pondéré plus faiblement**
  (`POIDS_ORPHELIN_BLOC`) → on privilégie le confort de la famille. Qualité au
  **score moyen par siège**, pénalité de **fragmentation**, retenue de **zone**.
  custom = défaut réel du runtime (doc/templates corrigés). Voir `PLACEMENT.md`.
- [x] **Placement — plafond de sélection.** On ne peut plus sélectionner plus de
  `partySize` sièges (avant : possible mais « Valider » grisé). Désélection OK
  pour échanger ; sièges non sélectionnés non cliquables au plafond
  (`SeatMap` prop `lockUnselected`).
- [x] **/admin/stats — vue d'ensemble + graphes.** **Comparaison par année** en
  tête (tableau + 3 graphes : billets, recette billetterie, recette buvette),
  puis **détail par représentation** en blocs **repliables** (`<details>`, pliés
  par défaut). Graphes SVG/CSS inline (zéro dépendance, `charts.tsx`) : jauge de
  remplissage, barres adultes/enfants, **courbe des demandes dans le temps**
  (quadrillage, axes valeurs/dates, info-bulle au survol), caisse par mode,
  recette buvette par boisson. Cartes de tailles variées (courbe/caisse larges).

## ✅ Fait le 2026-06-24 (page publique)

- [x] **Page publique en 2 colonnes.** Sur grand écran (≥ 920 px), le formulaire
  de demande à gauche et une **FAQ** à droite ; empilé sur mobile (la FAQ passe
  sous le formulaire). FAQ = server component, accordéon `<details>` natif (zéro
  JS), 10 questions calées sur les règles métier. Nouveau `app/demande/faq.tsx`
  (+ `faq.module.css`) ; `app/page.tsx` / `page.module.css` restructurés.
- [x] **Fix « mots collés » (espaces JSX mangés).** Sous Turbopack/SWC, un nœud
  de texte JSX contenant une entité HTML (`&nbsp;`, `&apos;`, `&rsquo;`…) perd
  son **espace de tête** → l'espace après une balise inline est supprimé
  (« 14 joursaprès », « permanencesde l'école », « séparationdu groupe »). Corrigé
  en écrivant ces séparateurs en `{' '}` — page publique (FAQ, `page.tsx`,
  `demande-form.tsx`) **et** admin (`comptes`, `representations`). Voir le
  commentaire d'avertissement en tête de `app/demande/faq.tsx`.

## ✅ Fait le 2026-06-22 (argent + exploitation)

- [x] **Prix + montant dû + versements.** Prix unitaire global (Setting), montant
  dû = (places − **places offertes**) × prix, règlement en **versements multiples**
  (table `Payment`) avec **chèques échelonnés** (date de paiement). Soldée dérivée
  (net ≥ dû). Caisse depuis les versements + **« Chèques à déposer »** par mois +
  reste à encaisser / trop-perçu. Côté famille : montant indicatif + dû/reçu/reste.
  Détail : voir [README](README.md).
- [x] **Popup demandes « reste ouverte ».** Toutes les actions (versements,
  remboursement en bloc séparé, places offertes, etc.) en `useActionState` (pas de
  navigation). Filtre **paiement** (payées / non payées) sur la liste.
- [x] **Détection de doublons à la création admin.** Email = blocage (lien vers la
  demande) ; téléphone / nom = avertissement « êtes-vous sûr ? ».
- [x] **Téléphone stocké en chiffres** (`0612345678`), affiché formaté partout —
  recherche fiabilisée (migration des numéros existants).
- [x] **Scan : indice** quand la personne cherchée n'a pas de billet à scanner ici
  (non placée / autre date / annulée). Plan : hover custom, scène élargie, contour
  des places validées zébré par rang, anciennes places en orange vif, marquage
  « famille PMR » retiré.

## 🐛 Corrections

- [x] **Calibration à l'envers + rangées manquantes + sens pair/impair.**
  ✅ Corrigé le 2026-06-11 dans `config/venue.ts`. Lettrage réel rétabli :
  **A (fond) → Y (scène)**, 3 blocs (haute A→G / normale H→W / fosse X-Y).
  **2 rangs rétablis** dans le bloc du milieu (écarts de rayon G→H et L→M =
  2 rangs sautés à la calibration d'origine) : 23 → **25 rangs**, 773 →
  **754 sièges**. Comptes réels confirmés par Gautier : **P = 29** (impairs
  1→29, pairs 2→28), **J = 35** (impairs 1→35, pairs 2→34).
  **Numérotation** : impairs côté **jardin** (terrasse PMR accessible), pairs
  côté **cour** (sens confirmé Gautier 2026-06-11, inversion d'une ligne dans
  `lib/venue/generate.ts`). Layout du plan inchangé, calé sur le scan.
  ⚠️ **Reste à faire** : re-seeder (`pnpm db:seed`) **avant toute vente** — à
  refaire après ce correctif de numérotation.

## ✨ Écran de placement / déplacement

- [x] **Déplacement : pré-sélectionner les places actuelles.** ✅ 2026-06-11 —
  en mode déplacement, la sélection part des places actuelles de la réservation
  (`placement-view.tsx`).
- [x] **Bouton « Annuler le déplacement »** ✅ 2026-06-11 — bouton qui revient à
  la liste des demandes sans rien changer (visible en mode déplacement).

## ✨ Demandes / réservations

- [x] **Rectifier le nombre de places d'une demande.** ✅ 2026-06-11 — champ
  inline + `rectifierPlacesAction` / `changerNombrePlaces`. pending/paid : MAJ
  directe (vérif jauge si augmentation) ; placed : billets supprimés, retour en
  `paid` et redirection vers le placement pour ré-attribuer ; cancelled/expired
  refusé.
- [x] **L'admin peut passer commande pour quelqu'un.** ✅ 2026-06-11 — page
  `/admin/demandes/nouvelle` + `creerDemandeAdmin`, mêmes effets (jauge, email),
  sans rate-limit ni honeypot. Logique de création partagée dans
  `lib/booking/creer.ts`.

## ✨ Formulaire public

- [x] **Séparer « Nom » et « Prénom »** ✅ 2026-06-11 — deux champs ; stockés
  combinés dans `Booking.name` (`Prénom Nom`), donc recherche/affichage admin
  inchangés (toujours sur le nom complet, pas de migration DB).
- [x] **Forcer le format du téléphone** ✅ 2026-06-11 — masque de saisie client
  (`formatFrPhone`) + normalisation/validation zod serveur (`lib/public/phone.ts`),
  stocké au format `06 12 34 56 78`.

## ✨ Plan de salle

- [x] **Sauts de numérotation réels.** ✅ 2026-06-11 — `ArcConfig.firstNumber` :
  les numéros manquants de la salle (rangs M, O, R, T) sont reproduits sur les
  billets. Verrouillé par `tests/venue/numbering.test.ts` contre `place.md`.
- [x] **Multi-salles + créateur de salle.** ✅ 2026-06-11 — `VENUE_ID` charge
  `config/venues/<id>.json` (zod) ; `/admin/salles/nouvelle` : relevé en
  notation place.md + aperçu live + téléchargement du JSON. La géométrie
  générée est régulière (indicative) ; la numérotation/contiguïté est fidèle.
- [ ] **Modifier le plan de salle à la main** (retouches siège par siège depuis
  l'admin, sans éditer la config). Toujours **À CADRER** : surcouche
  `SeatPatch` en base vs édition de la config. En pratique, le créateur de
  salle + l'édition de `venue.ts`/JSON couvrent déjà les besoins connus —
  ne faire que si un vrai besoin émerge.
