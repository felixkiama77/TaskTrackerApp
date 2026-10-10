import { describe, expect, it } from 'vitest'
import { applyCommand, CommandError, runMaintenance } from '../../src/domain/commands'
import { overdueOccurrences, nextOccurrence } from '../../src/domain/occurrences'
import type { Command } from '../../src/domain/schemas'
import { ARCHIVE_RETENTION_MS, type AppData } from '../../src/domain/types'
import { at, dataWith, makeCtx, makeInput, makeTask } from './helpers'

function run(data: AppData, command: Command, now = at('2026-10-08', '10:00')) {
  return applyCommand(data, command, makeCtx(now))
}

describe('creating tasks (FR-1 – FR-5)', () => {
  it('stores every configured property', () => {
    const data = dataWith([], { categories: [{ id: 'c1', name: 'School', createdAt: 'x' }] })
    const { data: next } = run(data, {
      type: 'task/create',
      input: makeInput({
        title: '  Read chapter 4  ',
        priority: 'high',
        dueDate: '2026-10-12',
        dueTime: '19:30',
        recurrence: { kind: 'weekly', weekdays: [4, 1] },
        end: { kind: 'count', count: 6 },
        categoryIds: ['c1'],
        reminders: [60, 0],
      }),
    })
    expect(next.tasks[0]).toMatchObject({
      title: 'Read chapter 4',
      priority: 'high',
      startDate: '2026-10-12',
      dueTime: '19:30',
      recurrence: { kind: 'weekly', weekdays: [1, 4] },
      end: { kind: 'count', count: 6 },
      categoryIds: ['c1'],
      reminders: [0, 60],
      completed: {},
      exceptions: {},
    })
  })

  it('anchors monthly tasks on the due date’s day', () => {
    const { data } = run(dataWith(), {
      type: 'task/create',
      input: makeInput({ dueDate: '2026-01-31', recurrence: { kind: 'monthly', dayOfMonth: 5 } }),
    })
    expect(data.tasks[0].recurrence).toEqual({ kind: 'monthly', dayOfMonth: 31 })
  })

  it('does not mutate the previous state', () => {
    const before = dataWith()
    run(before, { type: 'task/create', input: makeInput() })
    expect(before.tasks).toHaveLength(0)
  })
})

describe('completing occurrences (FR-17)', () => {
  const daily = makeTask({
    id: 't',
    startDate: '2026-10-07',
    dueTime: '09:00',
    recurrence: { kind: 'daily' },
    end: { kind: 'count', count: 5 },
  })

  it('records the completion, archives a snapshot, and keeps the rest of the schedule', () => {
    const now = at('2026-10-08', '08:30')
    const { data } = run(
      dataWith([daily]),
      { type: 'occurrence/complete', taskId: 't', key: '2026-10-08' },
      now,
    )
    const task = data.tasks[0]
    expect(task.completed['2026-10-08']).toBe(new Date(now).toISOString())
    expect(data.archive).toHaveLength(1)
    expect(data.archive[0]).toMatchObject({
      occurrenceKey: '2026-10-08',
      classification: 'on-time',
      occurrenceNumber: 2,
    })
    expect(nextOccurrence(task, now)?.key).toBe('2026-10-09')
    // The missed occurrence before it is untouched.
    expect(overdueOccurrences(task, now).map((o) => o.key)).toEqual(['2026-10-07'])
  })

  it('completing the same occurrence twice creates only one archive record', () => {
    const first = run(dataWith([daily]), { type: 'occurrence/complete', taskId: 't', key: '2026-10-08' })
    const second = run(first.data, { type: 'occurrence/complete', taskId: 't', key: '2026-10-08' })
    expect(second.changed).toBe(false)
    expect(second.data.archive).toHaveLength(1)
  })

  it('classifies a late completion as overdue', () => {
    const { data } = run(
      dataWith([daily]),
      { type: 'occurrence/complete', taskId: 't', key: '2026-10-07' },
      at('2026-10-08', '10:00'),
    )
    expect(data.archive[0].classification).toBe('overdue')
  })

  it('undo removes the completion and its archive record', () => {
    const done = run(dataWith([daily]), { type: 'occurrence/complete', taskId: 't', key: '2026-10-08' })
    const undone = run(done.data, { type: 'occurrence/uncomplete', taskId: 't', key: '2026-10-08' })
    expect(undone.data.tasks[0].completed).toEqual({})
    expect(undone.data.archive).toEqual([])
  })

  it('rejects dates that are not part of the schedule', () => {
    expect(() =>
      run(dataWith([daily]), { type: 'occurrence/complete', taskId: 't', key: '2026-12-01' }),
    ).toThrow(CommandError)
  })
})

describe('skipping', () => {
  it('a skipped occurrence can be restored (undo)', () => {
    const task = makeTask({
      id: 't',
      startDate: '2026-10-08',
      recurrence: { kind: 'daily' },
      end: { kind: 'never' },
    })
    const skipped = run(dataWith([task]), { type: 'occurrence/skip', taskId: 't', key: '2026-10-08' })
    expect(nextOccurrence(skipped.data.tasks[0], at('2026-10-08'))?.key).toBe('2026-10-09')
    const restored = run(skipped.data, { type: 'occurrence/restore', taskId: 't', key: '2026-10-08' })
    expect(restored.data.tasks[0].exceptions).toEqual({})
    expect(nextOccurrence(restored.data.tasks[0], at('2026-10-08'))?.key).toBe('2026-10-08')
    // Restoring something that was not skipped changes nothing.
    expect(run(restored.data, { type: 'occurrence/restore', taskId: 't', key: '2026-10-08' }).changed).toBe(
      false,
    )
  })

  const daily = makeTask({
    id: 't',
    startDate: '2026-10-05',
    recurrence: { kind: 'daily' },
    end: { kind: 'never' },
  })

  it('Skip all missed clears the overdue backlog without archiving anything', () => {
    const now = at('2026-10-08', '10:00')
    const { data, message } = run(dataWith([daily]), { type: 'task/skipMissed', taskId: 't' }, now)
    expect(overdueOccurrences(data.tasks[0], now)).toEqual([])
    expect(data.archive).toEqual([])
    expect(message).toBe('Skipped 3 missed occurrences.')
    expect(nextOccurrence(data.tasks[0], now)?.key).toBe('2026-10-08')
  })
})

describe('categories (FR-6 – FR-8)', () => {
  const base = () =>
    dataWith([makeTask({ id: 't', categoryIds: ['c1', 'c2'] })], {
      categories: [
        { id: 'c1', name: 'Work', createdAt: 'x' },
        { id: 'c2', name: 'Urgent', createdAt: 'x' },
      ],
    })

  it('rejects duplicate names regardless of case or surrounding spaces', () => {
    expect(() => run(base(), { type: 'category/create', name: '  work ' })).toThrow('already exists')
    expect(() => run(base(), { type: 'category/rename', categoryId: 'c2', name: 'WORK' })).toThrow(
      'already exists',
    )
  })

  it('deleting a category keeps its tasks and archive history, removing only the association', () => {
    const completed = run(base(), { type: 'occurrence/complete', taskId: 't', key: '2026-10-08' }).data
    const { data } = run(completed, { type: 'category/delete', categoryId: 'c1' })
    expect(data.categories.map((c) => c.id)).toEqual(['c2'])
    expect(data.tasks).toHaveLength(1)
    expect(data.tasks[0].categoryIds).toEqual(['c2'])
    expect(data.archive).toHaveLength(1)
    expect(data.archive[0].categoryNames).toEqual(['Work', 'Urgent'])
    expect(data.archive[0].categoryIds).toEqual(['c2'])
  })

  it('renaming updates live references but not archive snapshots', () => {
    const completed = run(base(), { type: 'occurrence/complete', taskId: 't', key: '2026-10-08' }).data
    const { data } = run(completed, { type: 'category/rename', categoryId: 'c1', name: 'Job' })
    expect(data.categories[0].name).toBe('Job')
    expect(data.tasks[0].categoryIds).toEqual(['c1', 'c2'])
    expect(data.archive[0].categoryNames).toEqual(['Work', 'Urgent'])
  })
})

describe('editing (FR-15)', () => {
  const weekly = () =>
    makeTask({
      id: 't',
      title: 'Gym',
      startDate: '2026-10-05',
      dueTime: '18:00',
      recurrence: { kind: 'weekly', weekdays: [1, 4] },
      end: { kind: 'count', count: 6 },
      completed: { '2026-10-05': '2026-10-05T22:00:00.000Z' },
    })
  const edited = makeInput({
    title: 'Gym (evening)',
    dueDate: '2026-10-08',
    dueTime: '19:00',
    recurrence: { kind: 'weekly', weekdays: [1, 4] },
    end: { kind: 'count', count: 6 },
  })

  it('“Only this occurrence” detaches it into a one-time task and leaves the series alone', () => {
    const { data } = run(dataWith([weekly()]), {
      type: 'task/update',
      taskId: 't',
      input: edited,
      scope: { kind: 'occurrence', key: '2026-10-08' },
    })
    const [series, single] = data.tasks
    expect(series.title).toBe('Gym')
    expect(series.exceptions['2026-10-08']).toBe('detached')
    expect(single).toMatchObject({ title: 'Gym (evening)', startDate: '2026-10-08', dueTime: '19:00' })
    expect(single.recurrence).toEqual({ kind: 'once' })
  })

  it('“This and future” splits the series; earlier history keeps the old rule and the count continues', () => {
    const { data } = run(dataWith([weekly()]), {
      type: 'task/update',
      taskId: 't',
      input: edited,
      scope: { kind: 'future', key: '2026-10-08' },
    })
    const [old, successor] = data.tasks
    expect(old).toMatchObject({
      title: 'Gym',
      endBefore: '2026-10-08',
      completed: { '2026-10-05': '2026-10-05T22:00:00.000Z' },
    })
    expect(successor).toMatchObject({ title: 'Gym (evening)', startDate: '2026-10-08', dueTime: '19:00' })
    // 6 occurrences in total; 1 happened before the split, so 5 remain.
    expect(successor.end).toEqual({ kind: 'count', count: 5 })
  })

  it('“This and future” from the first occurrence updates the series in place', () => {
    const task = { ...weekly(), completed: {} }
    const { data } = run(dataWith([task]), {
      type: 'task/update',
      taskId: 't',
      input: { ...edited, dueDate: '2026-10-05' },
      scope: { kind: 'future', key: '2026-10-05' },
    })
    expect(data.tasks).toHaveLength(1)
    expect(data.tasks[0]).toMatchObject({ id: 't', title: 'Gym (evening)', dueTime: '19:00' })
  })

  it('edits never change archive records', () => {
    const completed = run(dataWith([weekly()]), {
      type: 'occurrence/complete',
      taskId: 't',
      key: '2026-10-08',
    }).data
    const before = structuredClone(completed.archive)
    const { data } = run(completed, {
      type: 'task/update',
      taskId: 't',
      input: edited,
      scope: { kind: 'future', key: '2026-10-12' },
    })
    expect(data.archive).toEqual(before)
  })

  it('one-time tasks are edited directly', () => {
    const { data } = run(dataWith([makeTask({ id: 'one' })]), {
      type: 'task/update',
      taskId: 'one',
      input: makeInput({ title: 'New name', dueDate: '2026-10-10' }),
      scope: { kind: 'series' },
    })
    expect(data.tasks[0]).toMatchObject({ id: 'one', title: 'New name', startDate: '2026-10-10' })
  })
})

describe('deleting (FR-16)', () => {
  const daily = makeTask({
    id: 't',
    startDate: '2026-10-08',
    recurrence: { kind: 'daily' },
    end: { kind: 'never' },
  })

  it('“Only this occurrence” removes one date and keeps the series', () => {
    const { data } = run(dataWith([daily]), {
      type: 'task/delete',
      taskId: 't',
      scope: { kind: 'occurrence', key: '2026-10-08' },
    })
    expect(data.tasks[0].exceptions['2026-10-08']).toBe('skipped')
    expect(nextOccurrence(data.tasks[0], at('2026-10-08'))?.key).toBe('2026-10-09')
  })

  it('“Entire series” removes the task but keeps its archive records and other tasks', () => {
    const other = makeTask({ id: 'other' })
    const completed = run(dataWith([daily, other]), {
      type: 'occurrence/complete',
      taskId: 't',
      key: '2026-10-08',
    }).data
    const { data } = run(completed, { type: 'task/delete', taskId: 't', scope: { kind: 'series' } })
    expect(data.tasks.map((t) => t.id)).toEqual(['other'])
    expect(data.archive).toHaveLength(1)
  })
})

describe('maintenance (FR-20)', () => {
  it('purges expired archive records and old notification bookkeeping, never tasks, and is idempotent', () => {
    const completedAt = '2026-06-01T12:00:00.000Z'
    const data = dataWith([makeTask({ id: 'active' })], {
      archive: [{ id: 'old', completedAt } as AppData['archive'][number]],
      alerts: { delivered: { old: Date.parse(completedAt), recent: at('2026-10-07') }, lastCheckedAt: null },
    })
    const now = Date.parse(completedAt) + ARCHIVE_RETENTION_MS
    const once = runMaintenance(data, now)
    expect(once.changed).toBe(true)
    expect(once.data.archive).toEqual([])
    expect(once.data.tasks).toEqual(data.tasks)
    expect(Object.keys(once.data.alerts.delivered)).toEqual(['recent'])
    expect(runMaintenance(once.data, now).changed).toBe(false)
  })
})
