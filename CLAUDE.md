# Site Desha-Moulin — Contexte pour Claude Code

## C'est quoi ce projet

Site statique one-page pour l'école de danse de ma mère : **École de danse Desha-Moulin**, Bergerac (24100).
Pas de framework, pas de build tool, juste du HTML/CSS/JS vanilla. Un seul fichier à déployer.

## Fichiers

```
desha-moulin.html   → le site complet (une seule page)
annonce.js             → script CLI pour mettre à jour la bannière d'annonce
```

## Déploiement

Le site tourne sur un **Raspberry Pi** en local (Apache ou Nginx).
Le workflow c'est : modifier en local → vérifier → copier le HTML sur le Pi.
**Ne jamais modifier directement en prod.**

## Annonces

La bannière en haut du site change environ une fois par mois.
Le script `annonce.js` gère ça :

```bash
node annonce.js "Texte de la nouvelle annonce"   # changer l'annonce
node annonce.js --off                             # masquer la bannière
node annonce.js --on                              # réafficher
node annonce.js --status                          # voir l'annonce actuelle
```

Les marqueurs `<!-- ANNONCE_START -->` et `<!-- ANNONCE_END -->` dans le HTML délimitent le bloc modifiable. Ne pas les supprimer.

## Structure du site (sections dans l'ordre)

1. **Annonce** — bannière tout en haut, gérée par annonce.js
2. **Nav** — fixe, devient opaque au scroll
3. **Hero** — split 50/50 : texte à gauche (fond terre), photo à droite
4. **Stats band** — 4 chiffres clés
5. **L'école** — texte + photo avec badge rond
6. **Nos cours** — 4 cards (Éveil, Initiation, Classique, Modern'Jazz) avec horaires
7. **Planning** — 3 vues switchables : tableau semaine / par jour / par discipline
8. **Tarifs** — tableau service→prix (service en premier, prix discret à droite)
9. **Contact** — infos + card Instagram
10. **Footer**

## Design

- **Palette** : sable (`#faf7f2`, `#f2ece3`, `#e8ddd0`), terre (`#5c3d2e`), rose poudré (`#d4a090`), encre (`#1e1a16`)
- **Polices** : Lora (serif, titres) + Jost (sans-serif, corps)
- **Ambiance** : chaleureux, organique, studio de danse — pas de couleurs vives, pas de gradients flashy

## Ce qu'il y a souvent à faire

- Mettre à jour l'annonce → utiliser `annonce.js`
- Modifier les horaires → chercher les `sch-row` dans la section cours ET les `jour-slot` / `disci-slot` / cellules du tableau dans la section planning (les 3 vues sont à synchroniser)
- Modifier les tarifs → chercher les `tarif-ligne` et `spec-block`
- Ajouter une discipline → ajouter une `cours-card`, mettre à jour les 3 vues du planning

## Infos école

- **Fondée en** : 1949 par Myrio et Desha — 75+ ans d'histoire
- **Directrice actuelle** : Pascale Moulin — diplômée ESEC
- **Adresse** : 2–4 rue des Trois Frères Cassadou, 24100 Bergerac
- **Tél** : 06 69 35 39 25
- **Instagram** : @deshamoulin
- **Disciplines** : Éveil (4+), Initiation (6+), Classique (8+), Modern'Jazz (10+)
- **Frais d'inscription** : 16 €
