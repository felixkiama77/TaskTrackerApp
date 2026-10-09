import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Manual check (not part of `npm run test:e2e`): shows a REAL Windows notification from the built app
 * and reports whether Windows accepted it. Run with: npx playwright test tests/manual
 */
test('Windows accepts a real notification from the app', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'tasktracker-notify-'))
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TASK_TRACKER_USER_DATA: userData },
  })
  try {
    await app.firstWindow()
    const outcome = await app.evaluate(
      ({ Notification, app: electronApp }) =>
        new Promise<string>((resolve) => {
          if (!Notification.isSupported()) return resolve('unsupported')
          const n = new Notification({
            title: 'Task reminder',
            body: '“Submit history essay” is due in 30 minutes.',
          })
          n.on('show', () => resolve(`shown (AppUserModelID: ${electronApp.getName()})`))
          n.on('failed', (_e, error) => resolve(`failed: ${error}`))
          n.show()
          setTimeout(() => resolve('no response within 5s'), 5000)
        }),
    )
    console.log('Notification outcome:', outcome)
    expect(outcome).toMatch(/^shown/)
    await new Promise((r) => setTimeout(r, 4000)) // leave it on screen briefly for a screenshot
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
