import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  testMatch: process.env.MANUAL ? 'manual/**/*.spec.ts' : 'e2e/**/*.spec.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
