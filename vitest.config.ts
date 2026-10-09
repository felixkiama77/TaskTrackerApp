import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so unit tests never build or launch Electron.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // The user's zone (US Pacific). Fixed so date tests are deterministic; its 2026 DST changes are Mar 8 and Nov 1.
    env: { TZ: 'America/Los_Angeles' },
  },
})
