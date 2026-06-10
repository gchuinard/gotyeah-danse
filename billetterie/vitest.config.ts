// Config Vitest minimale — environnement node, AUCUN import de Next.
// Les tests ciblent des fonctions pures (lib/placement, lib/venue).

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Aligne l'alias `@` sur le tsconfig (paths: { "@/*": ["./*"] }).
    alias: { '@': path.dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
