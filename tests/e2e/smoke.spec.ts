import { expect, test } from '@playwright/test'
import { launchApp, tempUserData } from './fixtures'

test('launches with an isolated data folder on the expected Electron version', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir)
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dir)
    expect(await app.evaluate(() => process.versions.electron)).toMatch(/^44\./)
    await page.screenshot({ path: 'test-results/smoke.png' })
  } finally {
    await app.close()
    cleanup()
  }
})
