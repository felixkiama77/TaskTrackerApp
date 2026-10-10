import { expect, test, type Page } from '@playwright/test'
import { launchApp, tempUserData } from './fixtures'
import { dispatch, FAKE_NOW } from './seed'

/**
 * The editor and list controls through the real UI: every task property (FR-1 – FR-5, FR-15),
 * sorting (FR-11, FR-12), category filtering (FR-13), skip/undo and deletion scopes (FR-16).
 * "Now" is Thursday 8 Oct 2026, 10:00 Pacific.
 */
const nav = (page: Page, label: string) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click()

const snapshot = (page: Page) => page.evaluate(() => window.taskTracker.getSnapshot())

test('the editor saves every property, and sort, filter, skip, edit and delete work from the list', async () => {
  test.setTimeout(90_000)
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await dispatch(page, { type: 'category/create', name: 'Health' })
    await dispatch(page, {
      type: 'task/create',
      input: {
        title: 'Call the bank',
        priority: 'low',
        dueDate: '2026-10-09',
        dueTime: '11:00',
        recurrence: { kind: 'once' },
        end: { kind: 'never' },
        categoryIds: [],
        reminders: [],
      },
    })

    // Create a repeating task through the form, using every field.
    await page.getByRole('button', { name: 'New task' }).first().click()
    const editor = page.getByRole('dialog', { name: 'New task' })
    await editor.getByLabel('Name', { exact: true }).fill('Gym')
    await editor.getByLabel('Due time').fill('18:00')
    await editor.getByRole('radio', { name: 'High' }).check()
    await editor.getByLabel('Repeat').selectOption('weekly')
    await editor.getByRole('button', { name: 'Monday' }).click() // Thursday is preselected from the due date
    await editor.getByRole('radio', { name: 'After' }).check()
    await editor.getByLabel('Number of occurrences').fill('6')
    await expect(editor.getByText('Every Monday and Thursday, 6 times')).toBeVisible()
    await editor
      .getByRole('group', { name: /Categories/ })
      .getByRole('button', { name: 'Health' })
      .click()
    await editor.getByRole('button', { name: 'At due time' }).click()
    await editor.getByRole('button', { name: '15 min before' }).click()
    await editor.getByRole('button', { name: 'Create task' }).click()
    await expect(editor).toHaveCount(0)

    const created = (await snapshot(page)).data
    const gym = created.tasks.find((t) => t.title === 'Gym')!
    expect(gym).toMatchObject({
      priority: 'high',
      startDate: '2026-10-08',
      dueTime: '18:00',
      recurrence: { kind: 'weekly', weekdays: [1, 4] },
      end: { kind: 'count', count: 6 },
      categoryIds: [created.categories[0].id],
      reminders: [0, 15],
    })
    const gymRow = page.locator('.task-row', { hasText: 'Gym' }).first()
    await expect(gymRow).toContainText('Mon, Thu')
    await expect(gymRow).toContainText('Health')
    await expect(gymRow).toContainText('High')

    // Sorting by priority, both directions.
    const titles = () => page.locator('.task-row__title').allInnerTexts()
    await page.getByLabel('Sort by').selectOption('priority-desc')
    await expect.poll(titles).toEqual(['Gym', 'Call the bank'])
    await page.getByLabel('Sort by').selectOption('priority-asc')
    await expect.poll(titles).toEqual(['Call the bank', 'Gym'])
    await page.getByLabel('Sort by').selectOption('due-asc')

    // Category filter, then clearing it.
    const filters = page.getByRole('group', { name: 'Filter by category (matching any)' })
    await filters.getByRole('button', { name: 'Health' }).click()
    await expect.poll(titles).toEqual(['Gym'])
    await filters.getByRole('button', { name: 'Clear filters' }).click()
    await expect.poll(async () => (await titles()).length).toBe(2)

    // Skip today's Gym occurrence, then undo.
    await page.getByRole('button', { name: 'Skip this occurrence of “Gym”' }).first().click()
    await expect(page.getByRole('status').filter({ hasText: 'Occurrence skipped' })).toBeVisible()
    expect((await snapshot(page)).data.tasks.find((t) => t.title === 'Gym')!.exceptions).toEqual({
      '2026-10-08': 'skipped',
    })
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect
      .poll(async () => (await snapshot(page)).data.tasks.find((t) => t.title === 'Gym')!.exceptions)
      .toEqual({})

    // "This and future": change the time from the next occurrence on.
    await page.getByRole('button', { name: 'Edit “Gym”' }).first().click()
    await page.getByRole('dialog', { name: 'Edit task' }).getByLabel('Due time').fill('19:30')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('button', { name: /This and future occurrences/ }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Task updated.' })).toBeVisible()
    expect((await snapshot(page)).data.tasks.find((t) => t.title === 'Gym')!.dueTime).toBe('19:30')

    // Delete the one-time task (confirmation), then the whole repeating series.
    await page.getByRole('button', { name: 'Delete “Call the bank”' }).click()
    await page
      .getByRole('dialog', { name: 'Delete task?' })
      .getByRole('button', { name: 'Delete task' })
      .click()
    await expect(page.locator('.task-row', { hasText: 'Call the bank' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Delete “Gym”' }).first().click()
    await page.getByRole('button', { name: /Delete the entire series/ }).click()
    await page
      .getByRole('dialog', { name: 'Delete the entire series?' })
      .getByRole('button', { name: 'Delete series' })
      .click()
    await expect(page.locator('.task-row')).toHaveCount(0)
    expect((await snapshot(page)).data.tasks).toEqual([])
    await nav(page, 'All tasks')
  } finally {
    await app.close()
    cleanup()
  }
})
