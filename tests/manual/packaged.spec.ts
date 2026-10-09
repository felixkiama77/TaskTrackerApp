import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Manual check of the packaged app (run `npm run build` first, then `MANUAL=1 npx playwright test`).
 * Launches release/<version>/win-unpacked without installing anything, against a throwaway data folder.
 */
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
const exe = path.join('release', version, 'win-unpacked', 'Task Tracker.exe')

test('the packaged app runs with production settings and Windows accepts its notifications', async () => {
  test.skip(!existsSync(exe), `Build the installer first (${exe} not found).`)
  const userData = mkdtempSync(path.join(tmpdir(), 'tasktracker-packaged-'))
  const app = await electron.launch({
    executablePath: exe,
    env: { ...process.env, TASK_TRACKER_USER_DATA: userData },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('heading', { level: 1, name: 'All tasks' })).toBeVisible()

    const info = await page.evaluate(() => window.taskTracker.getAppInfo())
    expect(info).toMatchObject({ isPackaged: true, version })

    // Production Content Security Policy: no inline styles, no dev-server connections.
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toContain("style-src 'self';")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('ws://localhost')

    const shell = await app.evaluate(({ BrowserWindow, Menu }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return {
        menu: Menu.getApplicationMenu() === null,
        title: win.getTitle(),
        url: win.webContents.getURL(),
      }
    })
    expect(shell.menu).toBe(true)
    expect(shell.title).toContain('Task Tracker')
    expect(shell.url).toMatch(/^file:.*app\.asar\/dist\/index\.html$/)

    const outcome = await app.evaluate(
      ({ Notification }) =>
        new Promise<string>((resolve) => {
          const n = new Notification({ title: 'Task Tracker', body: 'Packaged build notification check.' })
          n.on('show', () => resolve('shown'))
          n.on('failed', (_e, error) => resolve(`failed: ${error}`))
          n.show()
          setTimeout(() => resolve('no response'), 5000)
        }),
    )
    expect(outcome).toBe('shown')
    await page.screenshot({ path: 'test-results/packaged-window.png' })
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
