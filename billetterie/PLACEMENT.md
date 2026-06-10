# PLACEMENT.md — l'algo de placement, ton terrain de jeu

Ce document est la spec de l'algorithme de placement intelligent de la billetterie.
Il définit le problème, le contrat, le vocabulaire et le harnais de mesure.
Il ne donne **aucune solution** : la résolution, c'est toi. Le fichier à remplir
est `lib/placement/custom.ts`, et tout le reste du projet est déjà câblé pour
l'accueillir.

## 1. Objectif & règles du jeu

Le contexte : le spectacle de fin d'année de l'école, au Centre Culturel de
Bergerac (salle en éventail, 23 rangées, 773 places modélisées, 3 sections
gauche / centre / droite, fosse AA/BB amovible, bloc avant A→N, allée
transversale, bloc arrière O→U — tout vient de `config/venue.ts`).

Les familles réservent **N places** (2 à 6 typiquement) et ne choisissent
**jamais** leur siège. Quand une réservation passe « payée », l'admin demande
des suggestions : ton algo propose **jusqu'à 3 options de placement**, et c'est
un humain qui valide. Toujours.

Ce que fait l'algo :

- recevoir l'état de la salle (sièges actifs, libres ou occupés) et une taille
  de groupe ;
- renvoyer au plus 3 suggestions, de la plus recommandée à la moins
  recommandée (la première est celle proposée par défaut à l'admin).

Ce qu'il ne fait **pas** :

- placer automatiquement sans validation humaine ;
- toucher à la base de données (fonction pure, zéro Prisma) ;
- choisir quelle réservation traiter — il répond à une demande, point.

L'objectif global que tu cherches à optimiser : **maximiser le remplissage ET
la qualité perçue** — groupes ensemble, bons sièges aux premiers payés, et
surtout ne pas semer derrière toi des sièges orphelins invendables.

Pour activer ton implémentation :

1. dans `lib/placement/custom.ts`, passe `implemented` à `true` (ça dé-skippe
   la suite de tests custom) ;
2. lance l'appli ou le simulateur avec `PLACEMENT_IMPL=custom`.

Le switch est dans `lib/placement/index.ts` (`getPlacement`) ; défaut :
`baseline`.

## 2. Le contrat

Copié depuis `lib/placement/types.ts` (qui fait foi) :

```ts
export type SeatState = {
  id: string // ex. "centre-A-03"
  section: string // 'gauche' | 'centre' | 'droite'
  rowId: string // ex. "centre-A" — la contiguïté n'existe QU'AU SEIN d'un rowId
  rowLabel: string
  rowOrder: number // 0 = rang le plus proche de la scène
  indexInRow: number // position dans SA section — consécutifs = voisins
  number: number // numéro affiché sur le billet
  score: number // score statique 0-100 (qualité intrinsèque du siège)
  free: boolean // false = déjà occupé par un Ticket
}

export type Suggestion = {
  seatIds: string[] // exactement partySize sièges, tous free
  score: number // qualité de la suggestion — informatif (affiché à l'admin)
}

export type PlacementFn = (seats: SeatState[], partySize: number) => Suggestion[]
```

Les sièges bloqués par un `SeatOverride` sont simplement **absents** du tableau
d'entrée : tu n'as pas à t'en soucier.

Les **5 invariants**, vérifiés par `tests/placement/invariants.test.ts` :

1. au plus 3 suggestions, ordonnées de la plus recommandée à la moins
   recommandée selon le classement PROPRE à l'implémentation — `score` est
   informatif, ce n'est pas une clé de tri imposée ;
2. chaque suggestion contient exactement `partySize` sièges, tous `free` ;
3. les sièges d'une suggestion forment, par `rowId`, des `indexInRow`
   consécutifs (jamais de trou, jamais de saut de section) ;
4. une suggestion tient sur UNE rangée, OU est scindée sur exactement
   2 rangées adjacentes (même section, `rowOrder` ±1) dont les plages
   d'`indexInRow` se chevauchent ;
5. déterminisme : l'ordre du tableau d'entrée ne change pas le résultat.

Et deux exigences transverses : la fonction est **pure** (ne mute jamais son
entrée) et **déterministe** (mêmes sièges + même taille → mêmes suggestions,
pas de `Math.random`, pas d'horloge).

## 3. Vocabulaire de la spec

Des définitions, pas des méthodes. Comment tu les exploites, c'est ton affaire.

### Score statique

La qualité intrinsèque 0-100 de chaque siège, **déjà calculée** et fournie dans
`SeatState.score`. Formule (voir `staticScore` dans `lib/venue/generate.ts`) :
une cloche gaussienne centrée entre les rangs E et H (pas le rang A, trop près
de l'avant-scène), pondérée 60 %, plus la centralité angulaire (proximité de
l'axe de la scène), pondérée 40 %. Tu n'as pas à recalculer ça — tu le consommes.

### Run

Une séquence **maximale** de sièges libres contigus : même `rowId`,
`indexInRow` consécutifs. Un run s'arrête à un siège occupé, à un bout de
section ou à un bout de rangée. La contiguïté ne traverse jamais une allée :
deux sections, deux runs.

### Fenêtre

Une sous-séquence de taille `partySize` à l'intérieur d'un run. C'est la forme
canonique d'une suggestion mono-rangée. Un run de longueur L contient
L − partySize + 1 fenêtres possibles.

### Malus des restes

Quand tu poses une fenêtre dans un run, tu laisses (éventuellement) deux
morceaux de run, un de chaque côté. Chaque morceau a un coût :

| Taille du reste | Malus | Lecture |
| --------------- | ----- | ------- |
| 1 siège         | 30    | quasi invendable — qui vient seul au gala ? |
| 2 sièges        | 8     | vendable (les duos sont la demande la plus fréquente) |
| 3 sièges        | 3     | correct |
| 4 sièges et +   | 0     | run encore pleinement exploitable |

Un reste de taille 0 (fenêtre collée au bord du run) ne coûte évidemment rien.

### Scission

Quand aucune fenêtre exacte n'existe pour le groupe, tu as le **droit** de le
couper en deux morceaux, sur **exactement 2 rangées adjacentes** : même
section, `rowOrder` ±1, et les plages d'`indexInRow` des deux morceaux doivent
**se chevaucher** — le groupe reste géographiquement ensemble, les uns devant
les autres, pas un duo à jardin et un quatuor à cour. Chaque morceau est
lui-même contigu (invariant 3). C'est un droit, pas une obligation : une
scission a un coût perçu, à toi de le chiffrer.

### Qualité d'une suggestion

La qualité d'une fenêtre (ou d'une scission) **combine** le score statique des
sièges qu'elle occupe et le malus des restes qu'elle crée. La pondération
exacte entre les deux, le coût d'une scission face à une mauvaise fenêtre,
l'arbitrage remplissage vs confort : rien de tout ça n'est imposé. C'est
exactement là que se joue ta partie — voir §6.

## 4. La baseline

`lib/placement/baseline.ts` est **volontairement naïve** : elle prend la
première fenêtre libre en partant du rang A, dans l'ordre de lecture, et
s'arrête à 3 propositions. Elle ignore le score statique, ignore le malus des
restes, ne scinde jamais.

Elle existe pour une seule raison : être **l'étalon du simulateur**. Toute
implémentation custom doit la battre, sinon à quoi bon.

Pourquoi elle est mauvaise : elle concentre tout le monde devant (y compris la
fosse et le rang A, qui ont de mauvais scores statiques), elle découpe les runs
sans réfléchir et sème des restes de 1 siège un peu partout. Ne l'améliore
pas — l'intelligence va dans `custom.ts`.

## 5. Le harnais

### Tests d'invariants

```sh
pnpm test
```

Vérifie les invariants 1-5 sur la baseline. La suite custom est skippée tant
que `implemented = false` dans `custom.ts` ; dès que tu passes le flag à
`true`, elle s'active et ton implémentation doit tenir les mêmes invariants.

### Simulateur Monte Carlo

```sh
pnpm simulate --impl=baseline --runs=200 --seed=42
pnpm simulate --impl=custom --runs=200 --seed=42
```

Le principe : on simule des soirées de vente complètes. Des groupes arrivent
les uns après les autres, taille tirée selon la distribution observée :

| Taille de groupe | 2 | 3 | 4 | 5 | 6 |
| ---------------- | --- | --- | --- | --- | --- |
| Probabilité | 40 % | 25 % | 20 % | 10 % | 5 % |

À chaque demande, l'algo propose ; le simulateur prend la première suggestion ;
on continue jusqu'à la première demande **refusée** (aucune suggestion).

Le RNG est seedé (mulberry32) : même `--seed`, même séquence de groupes pour
les deux implémentations — la comparaison est donc à conditions strictement
identiques.

Métriques en sortie :

- **remplissage à la première demande refusée** — le chiffre roi : combien de
  sièges vendus avant le premier « désolé, on ne peut pas vous placer » ;
- **malus des restes finaux** — la somme des malus des runs résiduels en fin de
  simulation (mesure des miettes que tu as laissées) ;
- **histogramme** de la distribution des résultats sur les runs.

Pour comparer : lance les deux commandes ci-dessus avec le même `--seed` et le
même `--runs`, et mets les chiffres côte à côte. Si ton custom ne domine pas la
baseline sur le remplissage, retourne jouer.

## 6. Pistes d'évaluation & questions ouvertes

Des questions, pas de réponses. Chacune est un curseur que tu peux régler, et
le simulateur est là pour départager tes intuitions :

- **Premiers payés, meilleures places ?** Donner systématiquement la meilleure
  fenêtre disponible aux premiers payeurs est intuitif et équitable… mais
  est-ce que ça maximise le remplissage final, ou est-ce que lisser un peu la
  qualité préserve de meilleurs runs pour les gros groupes tardifs ?
- **Que vaut une scission ?** Un groupe de 5 scindé 3+2 aux rangs F-G, contre
  une fenêtre de 5 entière au rang U : lequel est « mieux » ? Le coût d'une
  scission est-il fixe, ou dépend-il de la taille du plus petit morceau ?
- **Faut-il protéger les grands runs ?** Poser un duo au milieu d'un run de 18
  ne crée aucun reste pénalisé (deux restes ≥ 4), et pourtant ça peut fragmenter
  la rangée pour la suite. Le malus des restes suffit-il, ou faut-il une notion
  de préservation au-delà ?
- **Tes 3 suggestions doivent-elles être proches ou diverses ?** Trois fenêtres
  quasi identiques, ou trois compromis différents (avant-confort, milieu-sûr,
  scission) pour donner un vrai choix à l'admin ?
- **La fosse et les bords** ont des scores statiques faibles. À quel moment de
  la soirée de vente acceptes-tu de les proposer ?
- **Remplissage vs confort** : si maximiser le remplissage dégrade le score
  statique moyen des groupes placés tôt, où places-tu le curseur ?

Aucune de ces questions n'a de réponse imposée. La seule règle : invariants
tenus, déterminisme respecté, et la baseline battue au simulateur. Amuse-toi.
