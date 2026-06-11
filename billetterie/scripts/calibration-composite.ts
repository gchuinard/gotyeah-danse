// Outil de calibration : superpose les sièges générés (rouge = fixe,
// bleu = amovible, vert = point de convergence) sur le scan de la fiche
// technique et écrit /tmp/composite-full.png. Permet de vérifier la config
// sans navigateur. Lancer depuis billetterie/ : npx tsx scripts/calibration-composite.ts
// (sharp est emprunté au node_modules du site vitrine, à la racine du repo).

import { createRequire } from 'node:module'
import { venueConfig } from '../config/venue'
import { generateSeats } from '../lib/venue/generate'

const sharp = createRequire('/mnt/c/Users/Orould/Desktop/GotYeahStudios/gotyeah-danse/package.json')('sharp')

// La calibration vérifie la géométrie MESURÉE sur le scan (vue régie) : on
// génère donc SANS le miroir vue-salle (mirror:false), sinon le plan apparaît
// retourné par rapport au scan.
const seats = generateSeats({ ...venueConfig, mirror: false })
const circles = seats
  .map(
    (s) =>
      `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="9" fill="${s.removable ? 'rgba(0,80,255,0.55)' : 'rgba(255,0,0,0.55)'}"/>`,
  )
  .join('')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1848" height="2612">${circles}<circle cx="716" cy="2520" r="14" fill="rgba(0,160,0,0.8)"/></svg>`

sharp('public/plan-scan.png')
  .composite([{ input: Buffer.from(svg) }])
  .png()
  .toFile('/tmp/composite-full.png')
  .then(() => console.log('seats:', seats.length))
