# Backlog

Idées et corrections en attente, notées au fil de l'eau (2026-06-11).
Aucun engagement d'ordre — prioriser à la demande.

## 🐛 Corrections

- [x] **Calibration à l'envers + rangées manquantes + sens pair/impair.**
  ✅ Corrigé le 2026-06-11 dans `config/venue.ts`. Lettrage réel rétabli :
  **A (fond) → Y (scène)**, 3 blocs (haute A→G / normale H→W / fosse X-Y).
  **2 rangs rétablis** dans le bloc du milieu (écarts de rayon G→H et L→M =
  2 rangs sautés à la calibration d'origine) : 23 → **25 rangs**, 773 →
  **809 sièges**. Comptes réels confirmés par Gautier : **P = 29** (impairs
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

- [ ] **Modifier le plan de salle à la main.** Donner un moyen d'ajuster le
  plan sans éditer `config/venue.ts` : à minima déplacer/ajouter/retirer des
  sièges individuels depuis l'admin. **À CADRER** (volontairement laissé de
  côté) : ça touche le contrat « le plan est généré depuis la config ». Options
  à trancher avant de coder — (a) surcouche en base `SeatPatch` appliquée
  par-dessus le plan généré, (b) éditeur graphique qui réécrit `venue.ts`,
  (c) ne rien faire et continuer à éditer `venue.ts` à la main (ce qu'on fait
  pour la calibration). Décider AVANT d'implémenter.
