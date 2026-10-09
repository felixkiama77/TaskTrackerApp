import { describe, expect, it } from 'vitest'
import {
  countScheduledBefore,
  scheduledDates,
  scheduledDatesBetween,
  scheduledIndexOf,
  type Schedule,
} from '../../src/domain/recurrence'

const dates = (schedule: Schedule, until?: string, take = 50) => {
  const result: string[] = []
  for (const item of scheduledDates(schedule, until)) {
    result.push(item.date)
    if (result.length >= take) break
  }
  return result
}

const base = { endBefore: null } as const

describe('scheduled dates', () => {
  it('one-time tasks have exactly their due date', () => {
    expect(
      dates({ ...base, startDate: '2026-10-08', recurrence: { kind: 'once' }, end: { kind: 'never' } }),
    ).toEqual(['2026-10-08'])
  })

  it('a repeat count is the total number of occurrences, including the first', () => {
    const schedule: Schedule = {
      ...base,
      startDate: '2026-10-08',
      recurrence: { kind: 'daily' },
      end: { kind: 'count', count: 3 },
    }
    expect(dates(schedule)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10'])
  })

  it('daily schedules cross daylight-saving changes without skipping or repeating a day', () => {
    const schedule: Schedule = {
      ...base,
      startDate: '2026-10-31',
      recurrence: { kind: 'daily' },
      end: { kind: 'never' },
    }
    expect(dates(schedule, '2026-11-03')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
  })

  it('weekly schedules use the selected weekdays', () => {
    const schedule: Schedule = {
      ...base,
      startDate: '2026-10-05', // Monday
      recurrence: { kind: 'weekly', weekdays: [1, 4] }, // Mon, Thu
      end: { kind: 'count', count: 4 },
    }
    expect(dates(schedule)).toEqual(['2026-10-05', '2026-10-08', '2026-10-12', '2026-10-15'])
  })

  it('a weekly series starting on an unselected day begins on the next selected day', () => {
    const schedule: Schedule = {
      ...base,
      startDate: '2026-10-07', // Wednesday
      recurrence: { kind: 'weekly', weekdays: [1, 4] },
      end: { kind: 'count', count: 2 },
    }
    expect(dates(schedule)).toEqual(['2026-10-08', '2026-10-12'])
  })

  it('monthly schedules on the 31st use the last day of shorter months and return to the 31st', () => {
    const schedule: Schedule = {
      ...base,
      startDate: '2026-01-31',
      recurrence: { kind: 'monthly', dayOfMonth: 31 },
      end: { kind: 'count', count: 5 },
    }
    expect(dates(schedule)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  })

  it('monthly schedules on the 29th land on Feb 29 in leap years', () => {
    const schedule: Schedule = {
      ...base,
      startDate: '2028-01-29',
      recurrence: { kind: 'monthly', dayOfMonth: 29 },
      end: { kind: 'count', count: 3 },
    }
    expect(dates(schedule)).toEqual(['2028-01-29', '2028-02-29', '2028-03-29'])
  })

  it('a split series keeps its anchor day after a clamped month', () => {
    // After a "this and future" split at Feb 28, the new series keeps anchor 31.
    const schedule: Schedule = {
      ...base,
      startDate: '2026-02-28',
      recurrence: { kind: 'monthly', dayOfMonth: 31 },
      end: { kind: 'count', count: 3 },
    }
    expect(dates(schedule)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('stops before endBefore', () => {
    const schedule: Schedule = {
      startDate: '2026-10-08',
      recurrence: { kind: 'daily' },
      end: { kind: 'never' },
      endBefore: '2026-10-11',
    }
    expect(dates(schedule)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10'])
  })

  it('never-ending schedules are bounded by `until`', () => {
    const schedule: Schedule = {
      ...base,
      startDate: '2026-10-08',
      recurrence: { kind: 'daily' },
      end: { kind: 'never' },
    }
    expect(dates(schedule, '2026-10-09', 1000)).toEqual(['2026-10-08', '2026-10-09'])
  })

  it('indexes count every scheduled date', () => {
    const schedule: Schedule = {
      ...base,
      startDate: '2026-10-05',
      recurrence: { kind: 'weekly', weekdays: [1, 4] },
      end: { kind: 'never' },
    }
    expect(scheduledIndexOf(schedule, '2026-10-12')).toBe(2)
    expect(scheduledIndexOf(schedule, '2026-10-13')).toBeNull()
    expect(countScheduledBefore(schedule, '2026-10-12')).toBe(2)
    expect(scheduledDatesBetween(schedule, '2026-10-08', '2026-10-12').map((d) => d.date)).toEqual([
      '2026-10-08',
      '2026-10-12',
    ])
  })
})
