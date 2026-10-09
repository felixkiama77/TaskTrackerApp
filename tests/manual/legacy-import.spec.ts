import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Manual check: imports data saved by the old version from a COPY of a real profile.
 *
 * 1. Copy "%APPDATA%\tasktracker\Local Storage" into an empty folder.
 * 2. Serve the renderer on the old dev origin (http://localhost:5173) without Electron.
 * 3. Run with LEGACY_PROFILE=<that folder> MANUAL=1 npx playwright test tests/manual/legacy-import.spec.ts
 */
const profile = process.env.LEGACY_PROFILE

test('tasks saved by the old version are imported once, from a copy of a real profile', async () => {
  test.skip(
    !profile || !existsSync(path.join(profile, 'Local Storage')),
    'Set LEGACY_PROFILE to a copied profile.',
  )
  const env = {
    ...process.env,
    TASK_TRACKER_USER_DATA: profile!,
    TASK_TRACKER_TEST_NOTIFIER: 'record',
    VITE_DEV_SERVER_URL: 'http://localhost:5173/',
  }
  let app = await electron.launch({ args: ['.'], env })
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('status').filter({ hasText: /^Imported \d+ task/ })).toBeVisible({
      timeout: 15_000,
    })
    const toast = await page
      .getByRole('status')
      .filter({ hasText: /^Imported/ })
      .innerText()
    console.log('Import message:', toast.replace(/\s+/g, ' '))
    const imported = await page.evaluate(() => window.taskTracker.getSnapshot())
    console.log(
      'Imported tasks:',
      imported.data.tasks.map(
        (t) => `${t.title} | ${t.startDate} ${t.dueTime ?? '(no time)'} | ${t.difficulty}`,
      ),
    )
    console.log(
      'Categories:',
      imported.data.categories.map((c) => c.name),
    )
    await page.screenshot({ path: 'test-results/legacy-import.png' })

    // A second launch does not import again.
    await app.close()
    app = await electron.launch({ args: ['.'], env })
    page = await app.firstWindow()
    await page.waitForTimeout(2000)
    const again = await page.evaluate(() => window.taskTracker.getSnapshot())
    expect(again.data.tasks).toHaveLength(imported.data.tasks.length)
    const file = JSON.parse(readFileSync(path.join(profile!, 'task-tracker-data.json'), 'utf8')) as {
      meta: { legacyImportedAt: string | null }
    }
    expect(file.meta.legacyImportedAt).not.toBeNull()
  } finally {
    await app.close()
  }
})
