import type { Page } from '@playwright/test'
import type { CommandInput, TaskInput } from '../../src/domain/schemas'

/** "Now" for seeded scenarios: Thursday 8 Oct 2026, 10:00 in US Pacific time (UTC-7). */
export const FAKE_NOW = '2026-10-08T17:00:00.000Z'

export async function dispatch(page: Page, command: CommandInput) {
  const result = await page.evaluate((c) => window.taskTracker.dispatch(c), command)
  if (!result.ok) throw new Error(`${command.type} failed: ${result.error}`)
  return result
}

const task = (overrides: Partial<TaskInput>): TaskInput => ({
  title: 'Task',
  priority: 'medium',
  notes: '',
  link: null,
  dueDate: '2026-10-08',
  dueTime: null,
  recurrence: { kind: 'once' },
  end: { kind: 'never' },
  categoryIds: [],
  reminders: [],
  ...overrides,
})

/** A realistic mix: overdue, due today, upcoming, repeating, and completed (early/on time/late). */
export async function seedRealisticData(page: Page) {
  for (const name of ['School', 'Work', 'Home', 'Health'])
    await dispatch(page, { type: 'category/create', name })
  const snapshot = await page.evaluate(() => window.taskTracker.getSnapshot())
  const cat = (name: string) => snapshot.data.categories.find((c) => c.name === name)!.id

  const tasks: TaskInput[] = [
    task({
      title: 'Submit history essay',
      priority: 'high',
      dueDate: '2026-10-09',
      dueTime: '17:00',
      categoryIds: [cat('School')],
      reminders: [0, 60],
    }),
    task({
      title: 'Pay electricity bill',
      dueDate: '2026-10-07',
      categoryIds: [cat('Home')],
      reminders: [1440],
    }),
    task({
      title: 'Team standup notes',
      priority: 'low',
      dueDate: '2026-10-06',
      dueTime: '09:30',
      recurrence: { kind: 'daily' },
      categoryIds: [cat('Work')],
      reminders: [15],
    }),
    task({
      title: 'Gym',
      dueDate: '2026-10-05',
      dueTime: '18:00',
      recurrence: { kind: 'weekly', weekdays: [1, 3, 5] },
      end: { kind: 'count', count: 12 },
      categoryIds: [cat('Health')],
    }),
    task({
      title: 'Water the plants',
      priority: 'low',
      dueDate: '2026-10-08',
      recurrence: { kind: 'weekly', weekdays: [4] },
      categoryIds: [cat('Home')],
    }),
    task({
      title: 'Pay rent',
      priority: 'high',
      dueDate: '2026-08-31',
      recurrence: { kind: 'monthly', dayOfMonth: 31 },
      categoryIds: [cat('Home')],
      reminders: [2880],
    }),
    task({
      title: 'Dentist appointment',
      dueDate: '2026-10-08',
      dueTime: '14:00',
      categoryIds: [cat('Health')],
      reminders: [60],
    }),
    task({
      title: 'Read chapter 5 of the biology textbook before the quiz',
      dueDate: '2026-10-10',
      categoryIds: [cat('School')],
    }),
    task({ title: 'Return library books', priority: 'low', dueDate: '2026-10-12' }),
    task({ title: 'Call grandma', priority: 'low', dueDate: '2026-10-08' }),
    task({
      title: 'Quarterly report draft',
      priority: 'high',
      dueDate: '2026-10-14',
      dueTime: '12:00',
      categoryIds: [cat('Work'), cat('School')],
    }),
  ]
  for (const input of tasks) await dispatch(page, { type: 'task/create', input })

  const after = await page.evaluate(() => window.taskTracker.getSnapshot())
  const id = (title: string) => after.data.tasks.find((t) => t.title === title)!.id
  // Rent: Aug 31 and Sep 30 were paid (late, since "now" is Oct 8), so the next is Oct 31.
  await dispatch(page, { type: 'occurrence/complete', taskId: id('Pay rent'), key: '2026-08-31' })
  await dispatch(page, { type: 'occurrence/complete', taskId: id('Pay rent'), key: '2026-09-30' })
  await dispatch(page, { type: 'occurrence/complete', taskId: id('Gym'), key: '2026-10-05' })
  await dispatch(page, { type: 'occurrence/complete', taskId: id('Gym'), key: '2026-10-07' })
  await dispatch(page, { type: 'occurrence/complete', taskId: id('Return library books'), key: '2026-10-12' })
  await dispatch(page, { type: 'occurrence/complete', taskId: id('Call grandma'), key: '2026-10-08' })
}
