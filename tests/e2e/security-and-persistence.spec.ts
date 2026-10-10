import { expect, test } from '@playwright/test'
import { launchApp, tempUserData } from './fixtures'

const input = {
  title: 'Submit assignment',
  priority: 'high',
  dueDate: '2026-10-09',
  dueTime: '17:00',
  recurrence: { kind: 'once' },
  end: { kind: 'never' },
  categoryIds: [],
  reminders: [30],
}

test('the page only sees the narrow taskTracker API (FR-26, Electron security)', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir)
  try {
    const exposed = await page.evaluate(() => ({
      api: Object.keys(window.taskTracker).sort(),
      ipcRenderer: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }))
    expect(exposed).toEqual({
      api: [
        'checkImportsNow',
        'chooseImportFolder',
        'chooseSound',
        'clearImportFolder',
        'dispatch',
        'getAppInfo',
        'getImportStatus',
        'getSnapshot',
        'importLegacy',
        'onAlert',
        'onImportChecked',
        'onNavigate',
        'onSnapshot',
        'onWindowVisibility',
        'openDataFolder',
        'openTaskLink',
        'removeSound',
        'reportAudio',
        'testNotification',
      ],
      ipcRenderer: 'undefined',
      require: 'undefined',
      process: 'undefined',
    })

    // getLastWebPreferences exists at runtime but is missing from Electron 44's type definitions.
    type Prefs = { contextIsolation?: boolean; sandbox?: boolean; nodeIntegration?: boolean }
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as {
        getLastWebPreferences(): Prefs | null
      }
      const last = contents.getLastWebPreferences()
      return {
        contextIsolation: last?.contextIsolation,
        sandbox: last?.sandbox,
        nodeIntegration: last?.nodeIntegration,
      }
    })
    expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false })

    // Malformed and unknown commands are rejected without changing anything.
    const rejected = await page.evaluate(() =>
      Promise.all([
        window.taskTracker.dispatch({ type: 'fs/delete', path: 'C:/' } as never),
        window.taskTracker.dispatch({ type: 'task/create', input: { title: '' } } as never),
      ]),
    )
    expect(rejected.every((r) => !r.ok)).toBe(true)
    expect((await page.evaluate(() => window.taskTracker.getSnapshot())).data.tasks).toEqual([])

    // The audio report only accepts known notification kinds.
    await expect(
      page.evaluate(() =>
        window.taskTracker.reportAudio({ customNotificationSounds: ['../../evil'] } as never),
      ),
    ).rejects.toThrow()

    // Only a link stored on an existing task can be opened, never an arbitrary URL.
    const opened = await page.evaluate(async () => {
      await window.taskTracker.dispatch({
        type: 'task/create',
        input: {
          title: 'No link',
          priority: 'medium',
          dueDate: '2026-10-09',
          dueTime: null,
          recurrence: { kind: 'once' },
          end: { kind: 'never' },
          categoryIds: [],
          reminders: [],
        },
      })
      const [task] = (await window.taskTracker.getSnapshot()).data.tasks
      return Promise.all([
        window.taskTracker.openTaskLink(task.id),
        window.taskTracker.openTaskLink('no-such-task'),
      ])
    })
    expect(opened).toEqual([false, false])
    await expect(
      page.evaluate(() => window.taskTracker.openTaskLink({ url: 'https://evil.example' } as never)),
    ).rejects.toThrow()
    expect(
      await app.evaluate(
        () => (globalThis as { __taskTrackerOpenedLinks?: string[] }).__taskTrackerOpenedLinks,
      ),
    ).toBeUndefined()
    await page.evaluate(async () => {
      const [task] = (await window.taskTracker.getSnapshot()).data.tasks
      await window.taskTracker.dispatch({ type: 'task/delete', taskId: task.id, scope: { kind: 'series' } })
    })

    // New windows and navigation away from the app are blocked.
    expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true)
    const before = page.url()
    await page.evaluate(() => {
      window.location.href = 'https://example.com'
    })
    await page.waitForTimeout(500)
    expect(page.url()).toBe(before)
  } finally {
    await app.close()
    cleanup()
  }
})

test('changes are saved and survive a restart (FR-33)', async () => {
  const { dir, cleanup } = tempUserData()
  try {
    const first = await launchApp(dir)
    const result = await first.page.evaluate(
      (i) => window.taskTracker.dispatch({ type: 'task/create', input: i as never }),
      input,
    )
    expect(result).toMatchObject({ ok: true, message: 'Task created.' })
    await first.app.close()

    const second = await launchApp(dir)
    const snapshot = await second.page.evaluate(() => window.taskTracker.getSnapshot())
    expect(snapshot.data.tasks).toHaveLength(1)
    expect(snapshot.data.tasks[0]).toMatchObject({
      title: 'Submit assignment',
      dueTime: '17:00',
      reminders: [30],
    })
    expect(snapshot.issues).toEqual([])
    await second.app.close()
  } finally {
    cleanup()
  }
})
