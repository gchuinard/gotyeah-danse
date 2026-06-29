// Constantes partagées des tests E2E : configuration du serveur de test, secret
// de session (forge d'auth), et données de DÉMO du seed (prisma/seed.ts) — la
// source de vérité que les specs ciblent. Aucun import Next ici (pur).

export const E2E_PORT = 3100
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`

// Secret de test (≥ 32 caractères) — DOIT être identique entre le serveur web
// (qui vérifie) et la forge de session du global-setup (qui signe).
export const E2E_SESSION_SECRET = 'e2e-session-secret-0123456789abcdef0123456789abcdef'

// Base SQLite jetable, hors du repo (jamais prisma/dev.db).
export const E2E_DATABASE_URL = 'file:/tmp/billetterie-e2e.db'

// storageState forgés par rôle (écrits par le global-setup).
export const ROLES_AUTH = {
  'super-admin': 'e2e/.auth/super-admin.json',
  admin: 'e2e/.auth/admin.json',
  scan: 'e2e/.auth/scan.json',
} as const

// Données de démo (prisma/seed.ts, hors production). Tarifs 12 € / 6 €.
export const DEMO = {
  prixAdulteCents: 1200,
  prixEnfantCents: 600,
  reps: {
    samedi: { id: 'rep-samedi', title: 'Samedi 20h30' },
    dimanche: { id: 'rep-dimanche', title: 'Dimanche 15h00' },
  },
  // Réservation PLACÉE (4 billets, rang R centre, soldée, remise papier).
  placee: {
    token: 'f6a8c0e2-4b6d-4f8a-9c1e-3d5f7a9b1c3e',
    name: 'Famille Dupuis',
    email: 'marion.dupuis@example.com',
    partySize: 4,
    rang: 'R',
    // qrTokens des 4 sièges (centre-R-04..07) — pour le lien direct /place.
    qrTokens: [
      '9b1d3f5a-7c9e-4b2d-8f4a-6c8e0a2c4e6f',
      '4d6f8a0c-2e4b-4d7f-9a1c-3e5a7c9e1f3b',
      'e2b4d6f8-0a2c-4e6b-8d0f-2a4c6e8b0d2f',
      '7a9c1e3b-5d7f-4a8c-9e2b-4f6a8c0e2a4c',
    ],
  },
  enAttente: {
    token: '5f1e7c1a-9b3d-4e6f-8a2c-0d4b6e8f1a3c',
    name: 'Camille Bertrand',
    email: 'camille.bertrand@example.com',
    partySize: 4,
  },
  // Payée et SOLDÉE (Julien Moreau, 2 places, 24 € espèces).
  payeeSoldee: {
    token: 'a2c4e6f8-1b3d-4f5a-9c7e-2d4f6a8b0c1e',
    name: 'Julien Moreau',
    email: 'julien.moreau@example.com',
    partySize: 2,
  },
  // Payée en ACOMPTE (Élodie Garnier, 6 places, PMR, 1 offerte, 30/60 €).
  payeeAcompte: {
    token: '3d5f7a9b-2c4e-4a6b-8d0f-1e3a5c7b9d2f',
    name: 'Élodie Garnier',
    email: 'elodie.garnier@example.com',
    partySize: 6,
  },
} as const
