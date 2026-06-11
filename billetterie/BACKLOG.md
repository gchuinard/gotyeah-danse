# Backlog

Idées et corrections en attente, notées au fil de l'eau (2026-06-11).
Aucun engagement d'ordre — prioriser à la demande.

## 🐛 Corrections

- [x] **Calibration à l'envers + rangées manquantes + miroir vue salle.**
  ✅ Corrigé le 2026-06-11 dans `config/venue.ts`. Lettrage réel rétabli :
  **A (fond) → Y (scène)**, 3 blocs (haute A→G / normale H→W / fosse X-Y).
  **2 rangs rétablis** dans le bloc du milieu (écarts de rayon G→H et L→M =
  2 rangs sautés à la calibration d'origine) : 23 → **25 rangs**, 773 →
  **837 sièges**. Comptes réels confirmés par Gautier : **P = 29** (impairs
  1→29, pairs 2→28), **J = 35** (impairs 1→35, pairs 2→34).
  **Miroir** : la fiche est dessinée côté régie (terrasse PMR à gauche sur la
  fiche, à droite dans la salle) → flag `mirror: true` retourne le plan en vue
  salle (impairs à droite/cour, pairs à gauche/jardin). Calibration en
  `mirror: false` pour rester calée sur le scan.
  ⚠️ **Reste à faire** : re-seeder (`pnpm db:seed`) **avant toute vente** — déjà
  fait une fois le 2026-06-11, à refaire après ce correctif miroir.

## ✨ Écran de placement / déplacement

- [ ] **Déplacement : pré-sélectionner les places actuelles.** Quand on entre
  en mode « déplacer », la sélection par défaut doit être les places déjà
  attribuées à la réservation (aujourd'hui : sélection vide).
- [ ] **Bouton « Annuler le déplacement »** pour sortir du mode sans rien
  changer et revenir à la liste des demandes.

## ✨ Demandes / réservations

- [ ] **Rectifier le nombre de places d'une demande.** Une famille prend
  6 billets puis finalement 5… ou 7. Permettre à l'admin de changer
  `partySize` — en gérant les cas : demande déjà placée (retirer/ajouter des
  billets ?), jauge insuffisante pour l'augmentation.
- [ ] **L'admin peut passer commande pour quelqu'un.** Créer une demande
  depuis le back-office (familles qui passent au studio ou appellent),
  sans rate-limit ni honeypot, avec les mêmes effets (email de confirmation,
  jauge).

## ✨ Formulaire public

- [ ] **Séparer « Nom » et « Prénom »** dans le formulaire (deux champs, deux
  labels) — mais la **recherche admin reste sur le nom complet** (un seul
  champ de recherche, comme aujourd'hui).
- [ ] **Forcer le format du téléphone** : `06 66 66 66 66` (masque de saisie /
  normalisation côté client + validation zod côté serveur).

## ✨ Plan de salle

- [ ] **Modifier le plan de salle à la main.** Donner un moyen d'ajuster le
  plan sans éditer `config/venue.ts` : à minima déplacer/ajouter/retirer des
  sièges individuels depuis l'admin. À cadrer : ça touche le contrat
  « le plan est généré depuis la config » (où stocker les retouches ?
  surcouche en base type `SeatPatch`, ou édition graphique de la config ?).
