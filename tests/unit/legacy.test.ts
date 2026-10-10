import { describe, expect, it } from 'vitest'
import { importLegacyData } from '../../src/domain/legacy'
import { overdueOccurrences } from '../../src/domain/occurrences'
import { TaskDefinitionSchema } from '../../src/domain/schemas'
import { at, dataWith, makeCtx } from './helpers'

// Shape written by the flatpickr version of the old renderer (observed in a real profile).
const flatpickrTasks = JSON.stringify([
  {
    internalId: 3,
    title: 'ppp',
    dueDate: '2026-06-24T23:00:00.000Z',
    includesTime: true,
    state: false,
    overDue: false,
    tags: ['1', '2'],
    priority: 'Normal',
  },
  {
    internalId: 1,
    title: 'Testing',
    dueDate: '2026-06-22T19:00:00.000Z',
    includesTime: true,
    state: false,
    overDue: true,
    tags: [],
    priority: 'Low',
  },
  {
    internalId: 2,
    title: 'Done thing',
    dueDate: '2026-06-25T07:00:00.000Z', // local midnight, as the old app stored date-only tasks
    includesTime: false,
    state: true,
    tags: ['2'],
    priority: 'High',
  },
  { internalId: 4, title: '   ', priority: 'High' },
  'not an object',
])
const tags = JSON.stringify([
  { tagName: '1', taskCount: 1 },
  { tagName: '2', taskCount: 2 },
  { tagName: '  ' },
])

describe('legacy localStorage import (FR-34)', () => {
  const now = at('2026-10-08', '10:00')

  it('converts tasks, categories and completed tasks without discarding anything readable', () => {
    const { data, report } = importLegacyData(dataWith(), { tasks: flatpickrTasks, tags }, makeCtx(now))
    expect(report).toEqual({
      alreadyImported: false,
      tasks: 4,
      completed: 1,
      categories: 2,
      repairedDates: 1,
      unreadable: 1,
    })
    expect(data.categories.map((c) => c.name)).toEqual(['1', '2'])

    const [ppp, testing, done, untitled] = data.tasks
    // 2026-06-24T23:00Z is 16:00 on Jun 24 in Pacific time.
    expect(ppp).toMatchObject({
      title: 'ppp',
      startDate: '2026-06-24',
      dueTime: '16:00',
      priority: 'medium',
    })
    expect(ppp.categoryIds).toHaveLength(2)
    expect(testing).toMatchObject({ priority: 'low', categoryIds: [] })
    expect(done).toMatchObject({ priority: 'high', dueTime: null, startDate: '2026-06-25' })
    expect(untitled).toMatchObject({ title: 'Untitled task', startDate: '2026-10-08' })

    // Completed tasks go to the archive with an honest "unknown" timing and are not overdue.
    expect(data.archive).toHaveLength(1)
    expect(data.archive[0]).toMatchObject({
      title: 'Done thing',
      classification: 'unknown',
      categoryNames: ['2'],
    })
    expect(overdueOccurrences(done, now)).toEqual([])
    // Everything produced is valid under the persistence schema.
    for (const task of data.tasks) expect(TaskDefinitionSchema.safeParse(task).success).toBe(true)
  })

  it('accepts the older date-only format', () => {
    const old = JSON.stringify([
      { internalId: 1, title: 'Old', dueDate: '2026-05-01', state: false, tags: [], priority: 'Low' },
    ])
    const { data } = importLegacyData(dataWith(), { tasks: old, tags: null }, makeCtx(now))
    expect(data.tasks[0]).toMatchObject({ startDate: '2026-05-01', dueTime: null })
  })

  it('reuses existing categories with the same name and runs only once', () => {
    const existing = dataWith([], { categories: [{ id: 'mine', name: '2', createdAt: 'x' }] })
    const first = importLegacyData(existing, { tasks: flatpickrTasks, tags }, makeCtx(now))
    expect(first.data.categories.map((c) => c.id)).toContain('mine')
    expect(first.report.categories).toBe(1)

    const second = importLegacyData(first.data, { tasks: flatpickrTasks, tags }, makeCtx(now))
    expect(second.report.alreadyImported).toBe(true)
    expect(second.data).toBe(first.data)
  })

  it('tolerates missing or corrupt storage', () => {
    const { report } = importLegacyData(dataWith(), { tasks: '{not json', tags: null }, makeCtx(now))
    expect(report.tasks).toBe(0)
  })
})
