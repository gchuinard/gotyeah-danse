# Salles (multi-salles)

Un fichier JSON par salle, au format `VenueConfig` (validé par
`lib/venue/schema.ts`). Pour activer une salle :

```sh
# .env / .env.production
VENUE_ID=ma-salle        # → charge config/venues/ma-salle.json
```

Sans `VENUE_ID`, la salle intégrée (Centre Culturel de Bergerac,
`config/venue.ts`) fait foi.

Les fichiers se créent avec le **créateur de salle** (`/admin/salles/nouvelle`,
aperçu live + téléchargement du JSON) ou à la main.

⚠️ Après tout changement de salle : `pnpm db:seed` (AVANT les ventes — le plan
en base doit suivre la config).
