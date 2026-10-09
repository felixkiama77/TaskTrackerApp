import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so unit tests never build or launch Electron.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
