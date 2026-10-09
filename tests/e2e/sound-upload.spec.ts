import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchApp, silentWav, tempUserData } from './fixtures'
import { dispatch, FAKE_NOW } from './seed'

/**
 * Choosing sounds in Settings › Sound, end to end: the real file import, the tt-sound:// protocol,
 * playback, music rotation, validation, replacement and persistence. Files are silent WAVs.
 */

/** The system file picker can't be automated, so tests tell the main process which files to "pick". */
async function willPick(app: ElectronApplication, files: string[]) {
  await app.evaluate((_electron, value) => {
    process.env.TASK_TRACKER_TEST_PICK_FILES = value
  }, files.join(path.delimiter))
}

/** Records every audio element the page plays and whether it finished or failed. */
async function spyOnPlayback(page: Page) {
  await page.evaluate(() => {
    const log: { src: string; state: string }[] = []
    ;(window as unknown as { __plays: typeof log }).__plays = log
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with .call(this) below
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.src
      log.push({ src, state: 'started' })
      this.addEventListener('ended', () => log.push({ src, state: 'ended' }), { once: true })
      this.addEventListener('error', () => log.push({ src, state: 'error' }), { once: true })
      return original.call(this)
    }
  })
}

const plays = (page: Page) =>
  page.evaluate(() => (window as unknown as { __plays: { src: string; state: string }[] }).__plays)

const openSettings = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Settings/ })
    .click()

test('choose event sounds and music tracks in Settings, hear them, and keep them after a restart', async () => {
  test.setTimeout(120_000)
  const picks = mkdtempSync(path.join(tmpdir(), 'tasktracker-picks-'))
  const file = (name: string, content: Buffer) => {
    const full = path.join(picks, name)
    writeFileSync(full, content)
    return full
  }
  const ding = file('Ding.wav', silentWav(0.2))
  const ding2 = file('Better Ding.wav', silentWav(0.2))
  const tracks = ['01 Morning.wav', '02 Focus.wav', '03 Evening.wav'].map((n) => file(n, silentWav(1)))
  const fake = file('not-really.mp3', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]))

  const { dir, cleanup } = tempUserData()
  let { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await spyOnPlayback(page)
    await openSettings(page)
    const sound = page.getByRole('region', { name: 'Sound' })

    // A sound for "Task completed".
    await willPick(app, [ding])
    await sound.getByRole('button', { name: 'Choose a file for “Task completed”' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Sound for “Task completed” updated' }),
    ).toBeVisible()
    await expect(sound.locator('.sound-row', { hasText: 'Task completed' })).toContainText(
      'Your file: Ding.wav',
    )

    // Preview plays it through the app's own sound protocol.
    await sound.getByRole('button', { name: 'Play the “Task completed” sound' }).click()
    await expect
      .poll(async () => (await plays(page)).filter((p) => p.state === 'ended').map((p) => p.src))
      .toContainEqual(expect.stringMatching(/^tt-sound:\/\/sound\/effects\/task-completed-[a-f0-9]{8}\.wav$/))

    // Completing a task plays it too.
    await dispatch(page, {
      type: 'task/create',
      input: {
        title: 'Practice scales',
        difficulty: 'easy',
        dueDate: '2026-10-08',
        dueTime: null,
        recurrence: { kind: 'once' },
        end: { kind: 'never' },
        categoryIds: [],
        reminders: [],
      },
    })
    const before = (await plays(page)).length
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: /^All tasks/ })
      .click()
    await page.getByRole('checkbox', { name: 'Mark “Practice scales” complete' }).click()
    await expect
      .poll(async () => (await plays(page)).slice(before).some((p) => p.state === 'ended'))
      .toBe(true)

    // A file that isn't audio is refused with a clear message.
    await openSettings(page)
    await willPick(app, [fake])
    await sound.getByRole('button', { name: 'Choose a file for “Overdue”' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'doesn’t look like an MP3' })).toBeVisible()
    await expect(sound.locator('.sound-row', { hasText: 'Overdue' })).toContainText('Windows sound')

    // Three music tracks at once, then music on.
    await willPick(app, tracks)
    await sound.getByRole('button', { name: 'Add tracks…' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Added 3 tracks' })).toBeVisible()
    const trackList = sound.getByRole('list', { name: 'Music tracks' })
    await expect(trackList.locator('.sound-row')).toHaveCount(3)
    await expect(trackList).toContainText('Morning')
    await expect(trackList).toContainText('Evening')
    await sound.getByRole('switch', { name: 'Play background music' }).check()
    await expect(sound).toContainText('Now playing')
    await expect
      .poll(async () => (await plays(page)).some((p) => p.src.includes('/music/') && p.state === 'started'))
      .toBe(true)

    // Remove one track.
    await sound.getByRole('button', { name: 'Remove the track “Focus”' }).click()
    await expect(trackList.locator('.sound-row')).toHaveCount(2)

    // Replacing a sound deletes the old copy.
    await willPick(app, [ding2])
    await sound.getByRole('button', { name: 'Choose a file for “Task completed”' }).click()
    await expect(sound.locator('.sound-row', { hasText: 'Task completed' })).toContainText(
      'Your file: Better Ding.wav',
    )
    expect(readdirSync(path.join(dir, 'sounds', 'effects'))).toHaveLength(1)
    expect(readdirSync(path.join(dir, 'sounds', 'music'))).toHaveLength(2)

    // Everything is still there after a restart.
    await app.close()
    ;({ app, page } = await launchApp(dir, { fakeNow: FAKE_NOW }))
    await openSettings(page)
    const after = page.getByRole('region', { name: 'Sound' })
    await expect(after.locator('.sound-row', { hasText: 'Task completed' })).toContainText(
      'Your file: Better Ding.wav',
    )
    await expect(after.getByRole('list', { name: 'Music tracks' }).locator('.sound-row')).toHaveCount(2)
    await expect(after.getByRole('switch', { name: 'Play background music' })).toBeChecked()

    // Removing the event sound falls back to none.
    await after.getByRole('button', { name: 'Remove your “Task completed” sound' }).click()
    await expect(after.locator('.sound-row', { hasText: 'Task completed' })).toContainText('No sound')
    expect(readdirSync(path.join(dir, 'sounds', 'effects'))).toHaveLength(0)
  } finally {
    await app.close()
    cleanup()
    rmSync(picks, { recursive: true, force: true })
  }
})
