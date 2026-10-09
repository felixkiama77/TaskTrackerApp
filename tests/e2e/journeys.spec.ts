import axe from 'axe-core'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, recordedNotifications, tempUserData } from './fixtures'
import { dispatch, FAKE_NOW, seedRealisticData } from './seed'

/** End-to-end journeys through the real UI of the built app, each with its own data folder. */

const nav = (page: Page, label: string) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click()

const baseInput = {
  difficulty: 'medium' as const,
  dueTime: null,
  recurrence: { kind: 'once' as const },
  end: { kind: 'never' as const },
  categoryIds: [] as string[],
  reminders: [] as number[],
}

test('create, validate, complete, undo, and find the task in Completed after a restart (FR-1, FR-17, FR-21, FR-33)', async () => {
  const { dir, cleanup } = tempUserData()
  try {
    let { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })

    // Validation: a blank name is explained and nothing is saved.
    await page.getByRole('button', { name: 'New task' }).first().click()
    await page.getByRole('button', { name: 'Create task' }).click()
    await expect(page.getByText('Enter a task name.')).toBeVisible()
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true')

    // Create.
    await page.getByLabel('Name', { exact: true }).fill('Buy groceries')
    await page.getByLabel('Due time').fill('18:00')
    await page.getByRole('radio', { name: 'Hard' }).check()
    await page.getByRole('button', { name: 'Create task' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Task created.' })).toBeVisible()
    const row = page.locator('.task-row', { hasText: 'Buy groceries' })
    await expect(row).toContainText('Due today')
    await expect(row).toContainText('Hard')

    // Complete, then undo.
    await page.getByRole('checkbox', { name: 'Mark “Buy groceries” complete' }).click()
    await expect(row).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.task-row', { hasText: 'Buy groceries' })).toHaveCount(1)

    // Complete for real; it is archived as on time.
    await page.getByRole('checkbox', { name: 'Mark “Buy groceries” complete' }).click()
    await expect(page.locator('.task-row', { hasText: 'Buy groceries' })).toHaveCount(0)
    await nav(page, 'Completed')
    await expect(page.locator('.archive-row', { hasText: 'Buy groceries' })).toContainText('On time')

    // Still there after a restart.
    await app.close()
    ;({ app, page } = await launchApp(dir, { fakeNow: FAKE_NOW }))
    await nav(page, 'Completed')
    await expect(page.locator('.archive-row', { hasText: 'Buy groceries' })).toContainText('On time')
    await nav(page, 'All tasks')
    await expect(page.locator('.task-row', { hasText: 'Buy groceries' })).toHaveCount(0)
    await app.close()
  } finally {
    cleanup()
  }
})

test('deleting a category keeps its tasks and completed history (FR-6, FR-7)', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await nav(page, 'Categories')
    await page.getByPlaceholder('New category name').fill('Work')
    await page.getByRole('button', { name: 'Add category' }).click()
    await expect(page.locator('.category-row', { hasText: 'Work' })).toBeVisible()
    // Duplicate names (any case) are rejected with an explanation.
    await page.getByPlaceholder('New category name').fill('  work ')
    await page.getByRole('button', { name: 'Add category' }).click()
    await expect(page.getByText('A category named “work” already exists.')).toBeVisible()

    const snapshot = await page.evaluate(() => window.taskTracker.getSnapshot())
    const work = snapshot.data.categories[0].id
    await dispatch(page, {
      type: 'task/create',
      input: { ...baseInput, title: 'Write report', dueDate: '2026-10-09', categoryIds: [work] },
    })
    await dispatch(page, {
      type: 'task/create',
      input: { ...baseInput, title: 'Send invoice', dueDate: '2026-10-08', categoryIds: [work] },
    })
    const ids = (await page.evaluate(() => window.taskTracker.getSnapshot())).data.tasks
    await dispatch(page, {
      type: 'occurrence/complete',
      taskId: ids.find((t) => t.title === 'Send invoice')!.id,
      key: '2026-10-08',
    })

    await page.getByRole('button', { name: 'Delete Work' }).click()
    await expect(page.getByRole('dialog')).toContainText('will be kept')
    await page.getByRole('button', { name: 'Delete category' }).click()
    await expect(page.locator('.category-row')).toHaveCount(0)

    await nav(page, 'All tasks')
    const report = page.locator('.task-row', { hasText: 'Write report' })
    await expect(report).toBeVisible()
    await expect(report.locator('.chip--category')).toHaveCount(0)
    await nav(page, 'Completed')
    await expect(
      page.locator('.archive-row', { hasText: 'Send invoice' }).locator('.chip--category'),
    ).toHaveText('Work')
  } finally {
    await app.close()
    cleanup()
  }
})

test('editing only one occurrence of a repeating task leaves the rest of the series (FR-15)', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await dispatch(page, {
      type: 'task/create',
      input: {
        ...baseInput,
        title: 'Standup',
        dueDate: '2026-10-09',
        dueTime: '09:30',
        recurrence: { kind: 'daily' },
      },
    })
    await nav(page, 'Next 3 days')
    await expect(page.locator('.task-row', { hasText: 'Standup' })).toHaveCount(3)

    await page.getByRole('button', { name: 'Edit “Standup”' }).first().click()
    await page.getByLabel('Name', { exact: true }).fill('Standup (client visit)')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('button', { name: /Only this occurrence/ }).click()

    await expect(page.locator('.task-row', { hasText: 'Standup (client visit)' })).toHaveCount(1)
    await expect(page.locator('.task-row__title').filter({ hasText: /^Standup$/ })).toHaveCount(2)
  } finally {
    await app.close()
    cleanup()
  }
})

test('a reminder shows a toast, a blue edge pulse and a native notification request (FR-22 – FR-25)', async () => {
  const { dir, cleanup } = tempUserData()
  // 09:44:50 Pacific; the task below has a reminder at 09:45.
  const { app, page } = await launchApp(dir, { fakeNow: '2026-10-08T16:44:50.000Z' })
  try {
    await dispatch(page, {
      type: 'task/create',
      input: {
        ...baseInput,
        title: 'Biology quiz',
        dueDate: '2026-10-08',
        dueTime: '10:00',
        reminders: [15],
      },
    })
    const toast = page.locator('.toast--reminder', { hasText: 'Task reminder' })
    await expect(toast).toBeVisible({ timeout: 25_000 })
    await expect(toast).toContainText('“Biology quiz” is due in 15 minutes.')
    await expect(page.locator('.edge-alert')).toHaveAttribute('data-tone', 'reminder')
    expect(await recordedNotifications(app)).toContainEqual(
      expect.objectContaining({ title: 'Task reminder', body: '“Biology quiz” is due in 15 minutes.' }),
    )

    // Clicking a notification opens that occurrence.
    const taskId = (await page.evaluate(() => window.taskTracker.getSnapshot())).data.tasks[0].id
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0].webContents.send('tt:navigate', {
        taskId: id,
        occurrenceKey: '2026-10-08',
      })
    }, taskId)
    await expect(page.getByRole('dialog', { name: 'Biology quiz' })).toBeVisible()
  } finally {
    await app.close()
    cleanup()
  }
})

test('reduced motion replaces the edge pulse with a steady outline (design spec §7)', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('tt:alert', {
        kind: 'overdue',
        title: 'Task overdue',
        body: '“Rent” is past its due time.',
      })
    })
    await expect(page.locator('.edge-alert')).toHaveClass(/is-static/)
    await expect(page.locator('.edge-alert')).toHaveAttribute('data-tone', 'overdue')
    await expect(page.locator('.toast--overdue')).toContainText('“Rent” is past its due time.')
  } finally {
    await app.close()
    cleanup()
  }
})

test('closing the window keeps reminders running in the tray; the quit setting really quits', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible())),
      )
      .toEqual([false])
    expect(await recordedNotifications(app)).toContainEqual(
      expect.objectContaining({ title: 'Task Tracker is still running' }),
    )

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
    await nav(page, 'Settings')
    await page.getByRole('radio', { name: 'Quit Task Tracker' }).check()
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible()
    const closed = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await closed
  } finally {
    await app.close().catch(() => undefined)
    cleanup()
  }
})

test('keyboard: Ctrl+N opens the editor, Escape closes it and returns focus; typed text survives refreshes', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    const newTask = page.getByRole('button', { name: 'New task' }).first()
    await newTask.focus()
    await page.keyboard.press('Control+n')
    await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible()
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(newTask).toBeFocused()

    // A half-typed category name survives a re-render caused by a data change.
    await nav(page, 'Categories')
    const field = page.getByPlaceholder('New category name')
    await field.fill('Gard')
    await dispatch(page, {
      type: 'task/create',
      input: { ...baseInput, title: 'Rerender', dueDate: '2026-10-08' },
    })
    await expect(page.locator('.page-header__summary')).toBeVisible()
    await expect(field).toHaveValue('Gard')
  } finally {
    await app.close()
    cleanup()
  }
})

interface AxeViolation {
  id: string
  impact?: string | null
  help: string
  nodes: { target: unknown[] }[]
}

/** Runs axe-core inside the page (the Playwright wrapper needs extra tabs, which Electron can't open). */
async function seriousViolations(page: Page, where: string): Promise<string[]> {
  await page.evaluate(axe.source)
  const violations = await page.evaluate(async () => {
    type Runner = { run: (ctx: Document, opts: object) => Promise<{ violations: AxeViolation[] }> }
    const runner = (window as unknown as { axe: Runner }).axe
    const result = await runner.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })
    return result.violations
  })
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${where}: ${v.id} (${v.impact}) — ${v.help} — ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(', ')}`,
    )
}

test('automated accessibility scan finds no serious problems on the main screens', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await seedRealisticData(page)
    const screens = ['All tasks', 'Today', 'Overdue', 'Calendar', 'Completed', 'Categories', 'Settings']
    const problems: string[] = []
    for (const screen of screens) {
      await nav(page, screen)
      await page.waitForTimeout(250)
      problems.push(...(await seriousViolations(page, screen)))
    }
    // Also scan the open editor dialog.
    await nav(page, 'All tasks')
    await page.getByRole('button', { name: 'New task' }).first().click()
    await page.getByLabel('Repeat').selectOption('weekly')
    problems.push(...(await seriousViolations(page, 'Editor')))
    expect(problems).toEqual([])
  } finally {
    await app.close()
    cleanup()
  }
})
