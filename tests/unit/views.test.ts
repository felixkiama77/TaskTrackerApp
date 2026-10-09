import { describe, expect, it } from 'vitest'
import {
  filterOccurrencesByCategories,
  occurrencesForView,
  sortOccurrences,
  viewRange,
} from '../../src/domain/views'
import { at, makeTask } from './helpers'

// Thursday 2026-10-08, 10:00.
const NOW = at('2026-10-08', '10:00')

const keys = (occs: { taskId: string; key: string }[]) => occs.map((o) => `${o.taskId}@${o.key}`)

describe('view date ranges (FR-14)', () => {
  it('Next 3 days covers tomorrow through three days from today', () => {
    expect(viewRange('next3', NOW, 1)).toEqual({ from: '2026-10-09', to: '2026-10-11' })
  })

  it('This week follows the configured first day of the week', () => {
    expect(viewRange('week', NOW, 1)).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(viewRange('week', NOW, 0)).toEqual({ from: '2026-10-04', to: '2026-10-10' })
  })

  it('uses local calendar dates, not rolling 24-hour windows', () => {
    const lateNight = at('2026-10-08', '23:30')
    expect(viewRange('today', lateNight, 1)).toEqual({ from: '2026-10-08', to: '2026-10-08' })
    expect(viewRange('next3', lateNight, 1)).toEqual({ from: '2026-10-09', to: '2026-10-11' })
  })
})

describe('view contents', () => {
  const tasks = [
    makeTask({ id: 'today', startDate: '2026-10-08', dueTime: '17:00' }),
    makeTask({ id: 'late', startDate: '2026-10-08', dueTime: '08:00' }),
    makeTask({ id: 'yesterday', startDate: '2026-10-07' }),
    makeTask({ id: 'sat', startDate: '2026-10-10' }),
    makeTask({ id: 'later', startDate: '2026-10-20' }),
    makeTask({ id: 'done', startDate: '2026-10-08', completed: { '2026-10-08': 'x' } }),
    makeTask({
      id: 'daily',
      startDate: '2026-10-07',
      dueTime: '09:00',
      recurrence: { kind: 'daily' },
      end: { kind: 'never' },
    }),
  ]

  it('Today shows every active occurrence dated today, including ones already overdue', () => {
    expect(keys(occurrencesForView(tasks, 'today', NOW, 1)).sort()).toEqual(
      ['daily@2026-10-08', 'late@2026-10-08', 'today@2026-10-08'].sort(),
    )
  })

  it('Next 3 days excludes today and lists each occurrence of a recurring task separately', () => {
    expect(keys(occurrencesForView(tasks, 'next3', NOW, 1)).sort()).toEqual(
      ['daily@2026-10-09', 'daily@2026-10-10', 'daily@2026-10-11', 'sat@2026-10-10'].sort(),
    )
  })

  it('Overdue shows every missed occurrence and nothing else', () => {
    expect(keys(occurrencesForView(tasks, 'overdue', NOW, 1)).sort()).toEqual(
      ['daily@2026-10-07', 'daily@2026-10-08', 'late@2026-10-08', 'yesterday@2026-10-07'].sort(),
    )
  })

  it('All shows overdue occurrences plus each task’s next one, never completed ones, without duplicates', () => {
    const all = keys(occurrencesForView(tasks, 'all', NOW, 1))
    expect(all.sort()).toEqual(
      [
        'today@2026-10-08',
        'late@2026-10-08',
        'yesterday@2026-10-07',
        'sat@2026-10-10',
        'later@2026-10-20',
        'daily@2026-10-07',
        'daily@2026-10-08',
        'daily@2026-10-09',
      ].sort(),
    )
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('category filter (FR-13)', () => {
  const tasks = [
    makeTask({ id: 'both', categoryIds: ['work', 'home'] }),
    makeTask({ id: 'work', categoryIds: ['work'] }),
    makeTask({ id: 'none', categoryIds: [] }),
  ]
  const occs = occurrencesForView(tasks, 'today', at('2026-10-08'), 1)

  it('a task with several categories appears under each of them', () => {
    expect(keys(filterOccurrencesByCategories(occs, new Set(['home'])))).toEqual(['both@2026-10-08'])
    expect(keys(filterOccurrencesByCategories(occs, new Set(['work'])))).toEqual([
      'both@2026-10-08',
      'work@2026-10-08',
    ])
  })

  it('several selected categories match any of them; none selected shows everything', () => {
    expect(filterOccurrencesByCategories(occs, new Set(['home', 'work']))).toHaveLength(2)
    expect(filterOccurrencesByCategories(occs, new Set())).toHaveLength(3)
  })

  it('a deleted category id simply matches nothing', () => {
    expect(filterOccurrencesByCategories(occs, new Set(['gone']))).toEqual([])
  })
})

describe('sorting (FR-11, FR-12)', () => {
  const tasks = [
    makeTask({ id: 'dateOnly', title: 'A', startDate: '2026-10-08', dueTime: null, difficulty: 'hard' }),
    makeTask({ id: 'evening', title: 'B', startDate: '2026-10-08', dueTime: '20:00', difficulty: 'easy' }),
    makeTask({ id: 'morning', title: 'C', startDate: '2026-10-08', dueTime: '08:00', difficulty: 'hard' }),
    makeTask({ id: 'tomorrow', title: 'D', startDate: '2026-10-09', dueTime: '07:00', difficulty: 'medium' }),
  ]
  const occs = occurrencesForView(tasks, 'all', at('2026-10-08', '06:00'), 1)
  const ids = (list: { taskId: string }[]) => list.map((o) => o.taskId)

  it('soonest first puts date-only tasks after timed tasks on the same day', () => {
    expect(ids(sortOccurrences(occs, { key: 'due', direction: 'asc' }))).toEqual([
      'morning',
      'evening',
      'dateOnly',
      'tomorrow',
    ])
  })

  it('latest first reverses the order', () => {
    expect(ids(sortOccurrences(occs, { key: 'due', direction: 'desc' }))).toEqual([
      'tomorrow',
      'dateOnly',
      'evening',
      'morning',
    ])
  })

  it('difficulty sorts Easy → Hard (or reverse) and breaks ties by due date', () => {
    expect(ids(sortOccurrences(occs, { key: 'difficulty', direction: 'asc' }))).toEqual([
      'evening',
      'tomorrow',
      'morning',
      'dateOnly',
    ])
    expect(ids(sortOccurrences(occs, { key: 'difficulty', direction: 'desc' }))).toEqual([
      'morning',
      'dateOnly',
      'tomorrow',
      'evening',
    ])
  })
})
