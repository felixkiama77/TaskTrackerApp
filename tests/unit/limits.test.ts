import { describe, expect, it } from 'vitest'
import { applyCommand, CommandError } from '../../src/domain/commands'
import { addDays, type Weekday } from '../../src/domain/dates'
import { importLegacyData } from '../../src/domain/legacy'
import { scheduledDates, scheduledDatesBetween, type Schedule } from '../../src/domain/recurrence'
import { MAX_CATEGORIES, MAX_TASKS } from '../../src/domain/types'
import { at, dataWith, makeCtx, makeInput, makeTask } from './helpers'

/** Deterministic pseudo-random numbers so failures are reproducible. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

describe('jumping ahead in long series gives exactly the same dates and positions', () => {
  it('matches stepping through every day, for 2,000 random daily and weekly schedules', () => {
    const random = seeded(2026)
    const pick = (n: number) => Math.floor(random() * n)
    for (let i = 0; i < 2000; i++) {
      const startDate = addDays('2000-01-01', pick(9000))
      const weekdays = [...new Set(Array.from({ length: 1 + pick(4) }, () => pick(7) as Weekday))]
      const schedule: Schedule = {
        startDate,
        recurrence: random() < 0.5 ? { kind: 'daily' } : { kind: 'weekly', weekdays },
        end: random() < 0.4 ? { kind: 'count', count: 1 + pick(400) } : { kind: 'never' },
        endBefore: random() < 0.2 ? addDays(startDate, 1 + pick(3000)) : null,
      }
      const from = addDays(startDate, pick(4000) - 200)
      const to = addDays(from, pick(60))
      const brute = Array.from(scheduledDates(schedule, to)).filter((d) => d.date >= from)
      expect(scheduledDatesBetween(schedule, from, to)).toEqual(brute)
    }
  }, 20_000) // Thousands of schedules; slow when many test files run at once.

  it('looks up a range in a 50-year-old daily series without walking every day', () => {
    const schedule: Schedule = {
      startDate: '1976-01-01',
      recurrence: { kind: 'daily' },
      end: { kind: 'never' },
      endBefore: null,
    }
    const started = performance.now()
    const result = scheduledDatesBetween(schedule, '2026-10-08', '2026-10-10')
    expect(result.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10'])
    expect(result[0].index).toBe(18_543) // days from 1976-01-01 to 2026-10-08
    expect(performance.now() - started).toBeLessThan(50)
  })
})

describe('limits on how much data can be created', () => {
  const ctx = () => makeCtx(at('2026-10-08'))

  it('refuses a new task beyond the limit with a clear message', () => {
    const full = dataWith(Array.from({ length: MAX_TASKS }, (_, i) => makeTask({ id: `t${i}` })))
    expect(() => applyCommand(full, { type: 'task/create', input: makeInput() }, ctx())).toThrow(CommandError)
    expect(() => applyCommand(full, { type: 'task/create', input: makeInput() }, ctx())).toThrow(
      'You can have up to 2,000 tasks',
    )
  })

  it('refuses a new category beyond the limit', () => {
    const categories = Array.from({ length: MAX_CATEGORIES }, (_, i) => ({
      id: `c${i}`,
      name: `C${i}`,
      createdAt: 'x',
    }))
    expect(() =>
      applyCommand(dataWith([], { categories }), { type: 'category/create', name: 'One more' }, ctx()),
    ).toThrow(`You can have up to ${MAX_CATEGORIES} categories`)
  })

  it('imports at most the task limit from old data', () => {
    const many = JSON.stringify(
      Array.from({ length: MAX_TASKS + 50 }, (_, i) => ({
        title: `T${i}`,
        dueDate: '2026-05-01',
        priority: 'Low',
      })),
    )
    const { report } = importLegacyData(dataWith(), { tasks: many, tags: null }, makeCtx(at('2026-10-08')))
    expect(report.tasks).toBe(MAX_TASKS)
  })
})
