import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, tempUserData } from './fixtures'
import { FAKE_NOW, seedRealisticData } from './seed'

/**
 * Renders every screen of the real app with realistic data and saves screenshots to
 * test-results/screens/ for visual review (design spec §11 step 10). Assertions only check that each
 * screen rendered; the screenshots themselves are inspected by a person.
 */
const DIR = 'test-results/screens'

async function setSize(app: ElectronApplication, width: number, height: number) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(350) // let short transitions finish
  await page.screenshot({ path: `${DIR}/${name}.png` })
}

async function nav(page: Page, label: string) {
  await page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${label}`) }).click()
}

test('capture every screen for visual review', async () => {
  test.setTimeout(120_000)
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await setSize(app, 1280, 820)
    await expect(page.getByRole('heading', { level: 1, name: 'All tasks' })).toBeVisible()
    await shot(page, '00-first-run-empty')

    await seedRealisticData(page)
    await expect(page.getByText('Submit history essay')).toBeVisible()
    await shot(page, '01-all-tasks')

    for (const [label, file] of [
      ['Today', '02-today'],
      ['Next 3 days', '03-next-3-days'],
      ['This week', '04-this-week'],
      ['Overdue', '05-overdue'],
      ['Calendar', '06-calendar-month'],
    ] as const) {
      await nav(page, label)
      await shot(page, file)
    }

    await page.getByRole('radio', { name: 'Agenda' }).check()
    await shot(page, '07-calendar-agenda')
    await page.getByRole('radio', { name: 'Month' }).check()

    await nav(page, 'Completed')
    await shot(page, '08-completed')
    await nav(page, 'Categories')
    await shot(page, '09-categories')
    await nav(page, 'Settings')
    await shot(page, '10-settings')

    // Editor with progressive disclosure for a weekly repeat.
    await nav(page, 'All tasks')
    await page.getByRole('button', { name: 'New task' }).first().click()
    await page.getByLabel('Name', { exact: true }).fill('Practice piano')
    await page.getByLabel('Due time').fill('19:00')
    await page.getByLabel('Repeat').selectOption('weekly')
    await page.getByRole('button', { name: 'Tuesday' }).click()
    await page.getByRole('button', { name: '15 min before' }).click()
    await shot(page, '11-editor-weekly')

    // Validation feedback.
    await page.getByLabel('Name', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Create task' }).click()
    await expect(page.getByText('Enter a task name.')).toBeVisible()
    await shot(page, '12-editor-validation')
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Detail dialog for a recurring task with a backlog.
    await page.getByRole('button', { name: /^Team standup notes, overdue/ }).first().click()
    await shot(page, '13-detail-recurring')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await shot(page, '14-delete-choice')
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Compact window: icon-only sidebar.
    await setSize(app, 820, 700)
    await shot(page, '15-compact-width')
  } finally {
    await app.close()
    cleanup()
  }
})
