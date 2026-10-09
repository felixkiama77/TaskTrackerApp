import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('packaged-style build launches and shows the main window', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'tasktracker-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TASK_TRACKER_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userData)
    expect(await app.evaluate(() => process.versions.electron)).toMatch(/^44\./)
    await window.screenshot({ path: 'test-results/smoke.png' })
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
