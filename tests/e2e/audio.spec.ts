import { expect, test } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchApp, tempUserData } from './fixtures'
import { FAKE_NOW } from './seed'

/** A silent 16-bit mono WAV, so the test exercises playback without making any noise. */
function silentWav(seconds: number, sampleRate = 22_050): Buffer {
  const samples = Math.round(seconds * sampleRate)
  const data = samples * 2
  const buffer = Buffer.alloc(44 + data)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + data, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16) // fmt chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36)
  buffer.writeUInt32LE(data, 40)
  return buffer
}

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

test('Settings › Sound explains what has been added and disables controls that would do nothing', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: /^Settings/ })
      .click()
    const section = page.getByRole('region', { name: 'Sound' })
    await expect(section).toBeVisible()
    // This build ships without audio files yet.
    await expect(section).toContainText('No sound effects have been added yet.')
    await expect(section).toContainText('notifications use the Windows sound')
    await expect(section).toContainText('No music has been added yet.')
    await expect(section.getByRole('switch', { name: 'Background music' })).toBeDisabled()
    await expect(section.getByRole('switch', { name: 'Sound effects' })).toBeDisabled()
    await expect(section.getByRole('slider', { name: 'Music volume' })).toBeDisabled()
  } finally {
    await app.close()
    cleanup()
  }
})
