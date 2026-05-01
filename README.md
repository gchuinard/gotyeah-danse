# gotyeah-danse

Site one-page de l'**École de danse Desha-Moulin** (Bergerac, 24100) — école fondée en 1949.

🌐 **Production** : [cours-danse-bergerac.fr](https://cours-danse-bergerac.fr/)

## Stack

HTML / CSS / JavaScript vanilla — pas de framework, pas de build.
Hébergé sur un Raspberry Pi (Nginx).

- `desha-moulin.html` — la page complète
- `style.css` — tous les styles
- `js/main.js` — interactions (nav, menu burger, FAQ, reveal-on-scroll)
- `annonce.js` — script CLI pour mettre à jour la bannière d'annonce
- `optimize-images.js` — génère les variantes WebP/AVIF responsive (via `sharp`)

## Lancer en local

Aucun build, juste servir le dossier :

```bash
# au choix :
python3 -m http.server 8080
npx http-server -p 8080
docker compose up   # voir docker-compose.yml + nginx.conf
```

Puis ouvrir `http://localhost:8080/desha-moulin.html`.

## Mettre à jour la bannière d'annonce

```bash
node annonce.js "Texte de la nouvelle annonce"   # remplacer le texte
node annonce.js --off                             # masquer la bannière
node annonce.js --on                              # réafficher
node annonce.js --status                          # voir l'état actuel
```

Le script édite le bloc délimité par `<!-- ANNONCE_START -->` / `<!-- ANNONCE_END -->` dans le HTML.

## Optimiser une image

Après ajout d'une photo dans `images/` :

```bash
npm install        # une fois (installe sharp)
npm run optimize   # génère images/optimized/*.{avif,webp,jpg}
```

Référencer ensuite les variantes dans le HTML via `<picture>` (voir les exemples existants).

## Cache busting

Les `<link>` et `<script>` portent un paramètre `?v=N`. **Bumper `N` à chaque modif du CSS ou du JS** pour forcer le refresh côté navigateur.

## Déploiement

```bash
# copier les fichiers modifiés sur le Pi
rsync -av --delete desha-moulin.html style.css js/ images/ pi@<host>:/var/www/desha-moulin/
```

⚠️ Ne jamais modifier directement en prod.

## Structure du site

1. Bannière d'annonce
2. Navigation (fixe, transparente sur le hero)
3. Hero — titre + CTA cours + lien Instagram
4. Bandeau de stats (75+ ans, 4 disciplines, dès 4 ans, 2 profs)
5. Présentation de l'école et des profs
6. Nos cours — 4 cartes par discipline (niveaux + horaires)
7. Planning — vue par jour (mardi/mercredi/vendredi/samedi)
8. Tarifs (formules mensuelles/trimestrielles + à la carte)
9. Inscription (étapes + formulaire PDF)
10. FAQ
11. Contact + carte + Instagram
12. Footer

## Disciplines proposées

| Discipline    | Âge minimum |
| ------------- | ----------- |
| Éveil         | 4 ans       |
| Initiation    | 6 ans       |
| Classique     | 8 ans       |
| Modern'Jazz   | 9 ans       |

## Source de vérité pour les horaires

La section **Planning** (vue par jour) fait foi. La section **Nos cours** doit être synchronisée dessus à chaque modification d'horaire.
