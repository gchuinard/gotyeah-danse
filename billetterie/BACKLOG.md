# Backlog

Idées et corrections en attente, notées au fil de l'eau (2026-06-11).
Aucun engagement d'ordre — prioriser à la demande.

## 🐛 Corrections

- [ ] **Calibration à l'envers + rangée manquante.** Le rang A se retrouve tout
  au fond alors qu'il doit être le plus proche de la scène, et il manque une
  rangée : la salle réelle va de **A à X**, la config actuelle s'arrête à U.
  → Tout est paramétrique : corriger `config/venue.ts` (ordre des rangées /
  orientation + rangée(s) manquante(s)), vérifier avec
  `npx tsx scripts/calibration-composite.ts` et `/admin/calibration`, puis
  re-seeder. ⚠️ À faire AVANT toute mise en prod sérieuse : les billets émis
  portent rang + numéro.

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
