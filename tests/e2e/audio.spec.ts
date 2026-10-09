import { expect, test } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchApp, silentWav, tempUserData } from './fixtures'
import { FAKE_NOW } from './seed'

test('audio plays from the app’s own files without a click, even while hidden in the tray', async () => {
  // Served next to index.html, i.e. from the same place as bundled sounds.
  const file = path.join('dist', 'e2e-silence.wav')
  writeFileSync(file, silentWav(0.3))
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    // Hide the window to the tray, as when a reminder fires in the background.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
      .toBe(false)

    const outcome = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const audio = new Audio('e2e-silence.wav')
          audio.addEventListener('ended', () => resolve('ended'))
          audio.addEventListener('error', () => resolve(`error ${audio.error?.code ?? '?'}`))
          audio.play().catch((error: Error) => resolve(`blocked: ${error.name}`))
          setTimeout(() => resolve('timeout'), 5000)
        }),
    )
    expect(outcome).toBe('ended')
  } finally {
    await app.close()
    cleanup()
    rmSync(file, { force: true })
  }
})

test('Settings › Sound shows each event’s current sound and offers to choose one', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: /^Settings/ })
      .click()
    const section = page.getByRole('region', { name: 'Sound' })
    await expect(section).toBeVisible()
    // Without any files, every event shows its fallback and offers a file picker.
    await expect(section).toContainText('Notifications currently use the Windows sound.')
    for (const label of ['Reminder', 'Due now', 'Overdue', 'Missed reminders summary']) {
      await expect(
        section.locator('.sound-row').filter({ has: page.getByText(label, { exact: true }) }),
      ).toContainText('Windows sound')
      await expect(section.getByRole('button', { name: `Choose a file for “${label}”` })).toBeEnabled()
    }
    for (const label of ['Task created', 'Task completed', 'Undo', 'Task deleted', 'Occurrence skipped']) {
      await expect(
        section.locator('.sound-row').filter({ has: page.getByText(label, { exact: true }) }),
      ).toContainText('No sound')
    }
    await expect(section.getByRole('button', { name: 'Add tracks…' })).toBeEnabled()
    // Volume has nothing to adjust until a sound exists.
    await expect(section.getByRole('slider', { name: 'Music volume' })).toBeDisabled()
    await expect(section.getByRole('slider', { name: 'Action sound volume' })).toBeDisabled()
  } finally {
    await app.close()
    cleanup()
  }
})
