import { defineConfig, devices } from '@playwright/test'

import { E2E_BASE_URL, E2E_DATABASE_URL, E2E_PORT, E2E_SESSION_SECRET } from './e2e/data'

// Tests E2E. Le serveur démarre sur une BASE JETABLE seedée (jamais dev.db) ;
// les sessions admin sont FORGÉES par le global-setup (pas d'OTP). Série
// (workers: 1) car serveur + base partagés.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 12_000 },
  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    // Le partage de place vérifie le contenu copié au presse-papier.
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // Base fraîche → migrations → seed (démo incluse, NODE_ENV ≠ production) → dev.
    command: `sh -c "rm -f /tmp/billetterie-e2e.db* && npx prisma migrate deploy && pnpm db:seed && pnpm exec next dev -p ${E2E_PORT}"`,
    url: E2E_BASE_URL,
    // /mnt/c (montage Windows) est lent au premier compile Next + seed.
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: E2E_SESSION_SECRET,
      ADMIN_EMAILS: 'admin@test.local,superadmin@test.local',
      APP_BASE_URL: E2E_BASE_URL,
      BREVO_API_KEY: '',
      TURNSTILE_SECRET_KEY: '',
    },
  },
})
