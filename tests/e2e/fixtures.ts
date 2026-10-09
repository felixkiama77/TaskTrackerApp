import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export function tempUserData(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tasktracker-e2e-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Launches the built app against a throwaway data folder, optionally at a fixed fake time. */
export async function launchApp(
  userData: string,
  options: { fakeNow?: string; env?: Record<string, string> } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      TASK_TRACKER_USER_DATA: userData,
      // Record notifications instead of showing real ones on the desktop during tests.
      TASK_TRACKER_TEST_NOTIFIER: 'record',
      ...(options.fakeNow ? { TASK_TRACKER_FAKE_NOW: options.fakeNow } : {}),
      ...options.env,
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** Notifications the app asked the OS to show (recorded in test mode). */
export function recordedNotifications(app: ElectronApplication) {
  return app.evaluate(
    () =>
      (globalThis as { __taskTrackerNotifications?: { title: string; body: string }[] })
        .__taskTrackerNotifications ?? [],
  )
}
