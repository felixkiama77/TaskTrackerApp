import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { launchApp, tempUserData } from './fixtures'
import { dispatch, FAKE_NOW } from './seed'

/**
 * Suggested tasks from a routine's file (docs/DECISIONS.md, "School automation"): the folder is
 * chosen in Settings, tasks appear with their link and notes, and your edits survive a later import.
 */
const nav = (page: Page, label: string) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click()

const suggestionsFile = (items: object[]) =>
  JSON.stringify({
    format: 'task-tracker-suggestions',
    version: 1,
    origin: 'Weekly coursework sync',
    generatedAt: '2026-10-08T10:00:00-07:00',
    suggestions: items,
  })

const lab = {
  system: 'tcss380-site',
  externalId: '2026au/week-2/lab-1',
  title: 'Lab 1: Erlang basics',
  notes: 'Week 2 lab. Submit on Canvas.',
  link: 'https://cfb3.github.io/TCSS380-26-AUTUMN/erlang/lab-1/',
  dueDate: '2026-10-11',
  dueTime: '23:59',
  priority: 'high',
  categories: ['School', 'TCSS 380'],
  reminders: [720, 360],
}

const openedLinks = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { __taskTrackerOpenedLinks?: string[] }).__taskTrackerOpenedLinks ?? [])

test('tasks suggested in the chosen folder are added, linked, and never overwrite your edits', async () => {
  const { dir, cleanup } = tempUserData()
  const inbox = path.join(dir, 'Task Tracker Inbox')
  await fs.mkdir(inbox)
  const { app, page } = await launchApp(path.join(dir, 'data'), {
    fakeNow: FAKE_NOW,
    env: { TASK_TRACKER_TEST_PICK_FOLDER: inbox },
  })
  try {
    for (const name of ['School', 'TCSS 380']) await dispatch(page, { type: 'category/create', name })
    await fs.writeFile(path.join(inbox, 'weekly-coursework.json'), suggestionsFile([lab]), 'utf8')

    await nav(page, 'Settings')
    const section = page.getByRole('region', { name: 'Suggested tasks' })
    await expect(section).toContainText('Not set')
    await section.getByRole('button', { name: 'Choose folder' }).click()

    // The folder is checked straight away and the result is announced.
    await expect(page.getByRole('status').filter({ hasText: 'Suggested tasks: 1 task added' })).toBeVisible()
    await expect(section.locator('.data-path')).toHaveText(inbox)
    await expect(section.locator('.import-report')).toContainText('Weekly coursework sync')
    await expect(section.locator('.import-report')).toContainText('1 added · 0 updated · 0 unchanged')

    await nav(page, 'All tasks')
    const row = page.locator('.task-row', { hasText: 'Lab 1: Erlang basics' })
    await expect(row).toContainText('High')
    await expect(row).toContainText('TCSS 380')

    // Details show the notes, the link and where the task came from; the link opens in the browser.
    await row.locator('.task-row__body').click()
    const detail = page.getByRole('dialog', { name: 'Lab 1: Erlang basics' })
    await expect(detail).toContainText('Week 2 lab. Submit on Canvas.')
    await expect(detail).toContainText('6 hours before, 12 hours before')
    await expect(detail).toContainText('Weekly coursework sync')
    await detail.getByRole('button', { name: 'Open cfb3.github.io' }).click()
    await expect.poll(() => openedLinks(app)).toEqual([lab.link])

    // You rename the task in the editor.
    await detail.getByRole('button', { name: 'Edit' }).click()
    const editor = page.getByRole('dialog', { name: 'Edit task' })
    await expect(editor.getByLabel('Notes')).toHaveValue('Week 2 lab. Submit on Canvas.')
    await expect(editor.getByLabel('Link')).toHaveValue(lab.link)
    await editor.getByLabel('Name', { exact: true }).fill('Lab 1 — start Tuesday')
    await editor.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.locator('.task-row', { hasText: 'Lab 1 — start Tuesday' })).toBeVisible()

    // The routine later renames it and moves the deadline: your name stays, the new date is used.
    await fs.writeFile(
      path.join(inbox, 'weekly-coursework.json'),
      suggestionsFile([{ ...lab, title: 'Lab 1: Erlang basics (updated)', dueDate: '2026-10-12' }]),
      'utf8',
    )
    await nav(page, 'Settings')
    await section.getByRole('button', { name: 'Check now' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Suggested tasks: 1 task updated' }),
    ).toBeVisible()
    await expect(section.locator('.import-report').first()).toContainText(
      '“Lab 1 — start Tuesday”: kept your name; the source changed it.',
    )
    const task = (await page.evaluate(() => window.taskTracker.getSnapshot())).data.tasks[0]
    expect(task).toMatchObject({ title: 'Lab 1 — start Tuesday', startDate: '2026-10-12' })

    // Checking again with nothing new says so, and adds nothing.
    await section.getByRole('button', { name: 'Check now' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'No new suggestions' })).toBeVisible()
    expect((await page.evaluate(() => window.taskTracker.getSnapshot())).data.tasks).toHaveLength(1)

    // Stopping keeps the tasks.
    await section.getByRole('button', { name: 'Stop using it' }).click()
    await expect(section).toContainText('Not set')
    expect((await page.evaluate(() => window.taskTracker.getSnapshot())).data.tasks).toHaveLength(1)
  } finally {
    await app.close()
    cleanup()
  }
})

test('the editor offers 6 and 12 hour reminders and checks links', async () => {
  const { dir, cleanup } = tempUserData()
  const { app, page } = await launchApp(dir, { fakeNow: FAKE_NOW })
  try {
    await page.getByRole('button', { name: 'New task' }).first().click()
    const editor = page.getByRole('dialog', { name: 'New task' })
    await editor.getByLabel('Name', { exact: true }).fill('Read chapter 4')
    await editor.getByLabel('Due time').fill('23:59')
    await editor.getByRole('button', { name: '12 hours before' }).click()
    await editor.getByRole('button', { name: '6 hours before' }).click()
    await editor.getByLabel('Link').fill('http://not-secure.example.com')
    await editor.getByRole('button', { name: 'Create task' }).click()
    await expect(editor.getByText('Enter a full link starting with https://')).toBeVisible()

    await editor.getByLabel('Link').fill('https://example.com/chapter-4')
    await editor.getByLabel('Notes').fill('Pages 80–112')
    await editor.getByRole('button', { name: 'Create task' }).click()
    await expect(editor).toBeHidden()
    const [task] = (await page.evaluate(() => window.taskTracker.getSnapshot())).data.tasks
    expect(task).toMatchObject({
      reminders: [360, 720],
      link: 'https://example.com/chapter-4',
      notes: 'Pages 80–112',
      source: null,
    })
  } finally {
    await app.close()
    cleanup()
  }
})
