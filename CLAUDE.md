# Site Desha-Moulin — Contexte pour Claude Code

## C'est quoi ce projet

Site statique one-page pour l'école de danse de ma mère : **École de danse Desha-Moulin**, Bergerac (24100).
Pas de framework, pas de build tool — HTML/CSS/JS vanilla.

## Fichiers

```
desha-moulin.html     → la page complète (structure)
style.css             → tous les styles
js/main.js            → JS du site (nav, menu burger, FAQ, reveal-on-scroll, etc.)
annonce.js            → CLI Node pour mettre à jour la bannière d'annonce
optimize-images.js    → CLI Node (sharp) pour générer les variantes WebP/AVIF responsive
fonts/                → woff2 (Lora + Jost, sous-set latin/latin-ext)
images/optimized/     → variantes générées par optimize-images.js
documents/            → PDF du formulaire d'inscription
nginx.conf, Dockerfile, docker-compose.yml → déploiement conteneurisé optionnel
robots.txt, sitemap.xml → SEO
```

## Déploiement

Le site tourne sur un **Raspberry Pi** en local (Apache ou Nginx).
Workflow : modifier en local → vérifier → copier les fichiers (HTML + CSS + JS + images) sur le Pi.
**Ne jamais modifier directement en prod.**

À chaque modif du CSS ou du JS, **bumper le `?v=N`** dans le `<link>` et le `<script>` du HTML pour forcer le refresh côté navigateur.

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

## Optimisation images

Quand on ajoute une nouvelle photo dans `images/`, lancer :

```bash
npm run optimize    # → node optimize-images.js
```

Le script génère les variantes WebP/AVIF à plusieurs largeurs dans `images/optimized/`. Les `<picture>` du HTML pointent vers ces variantes.

## Structure du site (sections dans l'ordre)

1. **Annonce** — bannière tout en haut, gérée par annonce.js (cachée en desktop ≥1101px)
2. **Nav** — fixe, transparente sur le hero, devient opaque au scroll
3. **Hero** — split 50/50 desktop : texte à gauche (fond terre) avec CTA "Découvrir les cours" + lien IG, photo à droite avec overlay actu
4. **Stats band** — 4 chiffres clés (75+ ans, 4 disciplines, dès 4 ans, 2 profs diplômées)
5. **L'école** — texte + photos des deux profs (Pascale & Aurore)
6. **Nos cours** — 4 cartes (Éveil, Initiation, Classique, Modern'Jazz) avec niveaux & horaires détaillés
7. **Planning** — vue par jour (4 cartes : mardi, mercredi, vendredi, samedi) + bouton "Imprimer"
8. **Tarifs** — formules mois/trimestre + cours à la carte + note réductions famille
9. **Inscription** — étapes + téléchargement formulaire PDF
10. **FAQ** — questions courantes (accordéon)
11. **Contact** — infos + carte + card Instagram
12. **Footer**

## Design

- **Palette** : sable (`#faf7f2`, `#f2ece3`, `#e8ddd0`), terre (`#5c3d2e`), terre-2 (`#8b5e4a`), rose poudré (`#d4a090`), encre (`#1e1a16`), gris-chd (`#7a7068`)
- **Polices** : Lora (serif, titres + accents italiques) + Jost (sans-serif, corps)
- **Ambiance** : chaleureux, organique, studio de danse — pas de couleurs vives, pas de gradients flashy

## Ce qu'il y a souvent à faire

- **Mettre à jour l'annonce** → `node annonce.js "..."`
- **Modifier les horaires** → la **section Planning fait foi**. Synchroniser ensuite les `sch-row` de la section "Nos cours" sur le planning.
- **Modifier les tarifs** → chercher les `tarif-ligne` (formules) et `spec-block` (à la carte)
- **Ajouter une discipline** → ajouter une `cours-card` dans la section "Nos cours" ET ajouter le créneau dans le planning par jour (avec la pastille de couleur correspondante : `dot-eveil` / `dot-init` / `dot-clas` / `dot-jazz`)
- **Ajouter une photo** → la mettre dans `images/`, lancer `npm run optimize`, référencer les variantes via `<picture>`

## Infos école

- **Fondée en** : 1949 par Myrio et Desha — 75+ ans d'histoire
- **Profs** :
  - Pascale Moulin (directrice) — diplômée ESEC
  - Aurore Largeau — Diplôme d'État (DE)
- **Adresse** : 2–4 rue des Trois Frères Cassadou, 24100 Bergerac
- **Tél** : 06 69 35 39 25
- **Instagram** : @deshamoulin
- **Disciplines** :
  - Éveil — à partir de 4 ans
  - Initiation — à partir de 6 ans
  - Classique — à partir de 8 ans
  - Modern'Jazz — à partir de 9 ans
- **Frais d'inscription** : 16 €
- **URL** : cours-danse-bergerac.fr
