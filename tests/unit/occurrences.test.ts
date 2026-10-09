import { describe, expect, it } from 'vitest'
import {
  deadline,
  findOccurrence,
  nextOccurrence,
  overdueOccurrences,
  statusOf,
} from '../../src/domain/occurrences'
import { at, makeTask } from './helpers'

describe('deadlines and overdue (FR-28)', () => {
  it('a date-only task is not overdue at the start of its due date, only after the day ends', () => {
    const task = makeTask({ startDate: '2026-10-08', dueTime: null })
    const occ = findOccurrence(task, '2026-10-08')!
    expect(statusOf(occ, at('2026-10-08', '00:00'))).toBe('today')
    expect(statusOf(occ, at('2026-10-08', '23:59'))).toBe('today')
    expect(statusOf(occ, at('2026-10-09', '00:00'))).toBe('overdue')
  })

  it('a timed task turns from today (green) to overdue (red) once its due time passes (FR-31)', () => {
    const task = makeTask({ startDate: '2026-10-08', dueTime: '17:00' })
    const occ = findOccurrence(task, '2026-10-08')!
    expect(statusOf(occ, at('2026-10-08', '16:59'))).toBe('today')
    expect(statusOf(occ, at('2026-10-08', '17:00'))).toBe('today')
    expect(statusOf(occ, at('2026-10-08', '17:01'))).toBe('overdue')
  })

  it('future occurrences are blue (future)', () => {
    const occ = findOccurrence(makeTask({ startDate: '2026-10-09' }), '2026-10-09')!
    expect(statusOf(occ, at('2026-10-08', '23:00'))).toBe('future')
  })

  it('date-only deadlines sort after any time on the same day', () => {
    expect(deadline('2026-10-08', null)).toBeGreaterThan(deadline('2026-10-08', '23:59'))
  })
})

describe('recurring occurrences', () => {
  const daily = makeTask({
    startDate: '2026-10-01',
    dueTime: '09:00',
    recurrence: { kind: 'daily' },
    end: { kind: 'never' },
  })

  it('every missed occurrence stays overdue on its own date', () => {
    const overdue = overdueOccurrences(daily, at('2026-10-04', '10:00'))
    expect(overdue.map((o) => o.key)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  })

  it('completed and skipped occurrences are not overdue, and the schedule continues', () => {
    const task = {
      ...daily,
      completed: { '2026-10-01': '2026-10-01T14:00:00.000Z' },
      exceptions: { '2026-10-02': 'skipped' as const },
    }
    const now = at('2026-10-03', '08:00')
    expect(overdueOccurrences(task, now)).toEqual([])
    expect(nextOccurrence(task, now)?.key).toBe('2026-10-03')
  })

  it('the next occurrence is the first active one that is not overdue', () => {
    const now = at('2026-10-03', '10:00') // today's 09:00 occurrence is already overdue
    expect(nextOccurrence(daily, now)?.key).toBe('2026-10-04')
  })

  it('a finished count-limited series has no next occurrence', () => {
    const task = makeTask({
      startDate: '2026-10-01',
      recurrence: { kind: 'daily' },
      end: { kind: 'count', count: 2 },
      completed: { '2026-10-01': 'x', '2026-10-02': 'x' },
    })
    expect(nextOccurrence(task, at('2026-10-01'))).toBeNull()
  })

  it('a completed occurrence stays completed regardless of the archive (no resurrection after purge)', () => {
    // Completion lives on the task, so removing the archive record cannot make it overdue again.
    const task = makeTask({
      startDate: '2026-06-01',
      completed: { '2026-06-01': '2026-06-01T12:00:00.000Z' },
    })
    expect(overdueOccurrences(task, at('2026-10-08'))).toEqual([])
  })
})
