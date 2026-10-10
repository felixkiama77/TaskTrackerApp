import { expect, test, type Page } from '@playwright/test'
import { launchApp, tempUserData } from './fixtures'
import { dispatch, FAKE_NOW } from './seed'

/** Interface paths not covered elsewhere: category rename (FR-8), calendar navigation (FR-30), live status refresh (FR-29). */
const nav = (page: Page, label: string) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click()

test('a category can be renamed from the Categories screen (FR-8)', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await dispatch(page, { type: 'category/create', name: 'Helth' })
    await nav(page, 'Categories')
    await page.getByRole('button', { name: 'Rename Helth' }).click()
    const field = page.getByRole('textbox', { name: 'New name for Helth' })
    await expect(field).toBeFocused()
    await field.fill('Health')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Category renamed to “Health”.' })).toBeVisible()
    await expect(page.locator('.category-row')).toContainText('Health')
    // Escape cancels a rename without changing anything.
    await page.getByRole('button', { name: 'Rename Health' }).click()
    await page.getByRole('textbox', { name: 'New name for Health' }).fill('Changed my mind')
    await page.keyboard.press('Escape')
    await expect(page.locator('.category-row')).toContainText('Health')
    expect((await page.evaluate(() => window.taskTracker.getSnapshot())).data.categories[0].name).toBe(
      'Health',
    )
  } finally {
    await app.close()
    cleanup()
  }
})

test('the calendar moves between months and back to today (FR-30)', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await nav(page, 'Calendar')
    const title = page.locator('.calendar-header__title')
    await expect(title).toHaveText('October 2026')
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(title).toHaveText('November 2026')
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(title).toHaveText('September 2026')
    await page.getByRole('main').getByRole('button', { name: 'Today', exact: true }).click()
    await expect(title).toHaveText('October 2026')
    await expect(page.locator('.calendar-day--today .calendar-day__number')).toHaveText('8')
  } finally {
    await app.close()
    cleanup()
  }
})

test('a task due today turns overdue on screen when its time passes, without any interaction (FR-29)', async () => {
  test.setTimeout(60_000)
  const { dir, cleanup } = tempUserData()
  // 09:59:50 Pacific; the task is due at 10:00.
  const { app, page } = await launchApp(dir, { fakeNow: '2026-10-08T16:59:50.000Z' })
  try {
    await dispatch(page, {
      type: 'task/create',
      input: {
        title: 'Team call',
        priority: 'medium',
        dueDate: '2026-10-08',
        dueTime: '10:00',
        recurrence: { kind: 'once' },
        end: { kind: 'never' },
        categoryIds: [],
        reminders: [],
      },
    })
    const row = page.locator('.task-row', { hasText: 'Team call' })
    await expect(row).toContainText('Due today')
    await expect(row).toHaveAttribute('data-status', 'today')
    // The window refreshes at the start of each minute.
    await expect(row).toHaveAttribute('data-status', 'overdue', { timeout: 30_000 })
    await expect(row).toContainText('Overdue')
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Overdue/ }),
    ).toContainText('1')
  } finally {
    await app.close()
    cleanup()
  }
})
