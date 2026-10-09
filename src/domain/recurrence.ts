import {
  addDays,
  compareDates,
  dateParts,
  diffDays,
  monthDateClamped,
  weekdayOf,
  type LocalDate,
} from './dates'
import type { Recurrence, RecurrenceEnd } from './types'

/** The parts of a task that determine its schedule. */
export interface Schedule {
  startDate: LocalDate
  recurrence: Recurrence
  end: RecurrenceEnd
  endBefore: LocalDate | null
}

export interface ScheduledDate {
  date: LocalDate
  /** 0-based position in the series; counts every scheduled date, including skipped or completed ones. */
  index: number
}

/** Safety limit for open-ended iteration when no upper bound is given. */
const MAX_OCCURRENCES = 100_000

/**
 * Yields the series' scheduled dates in order, up to and including `until` when given.
 *
 * - once: the start date.
 * - daily: every day from the start date.
 * - weekly: each selected weekday on or after the start date (the start date itself only if its
 *   weekday is selected).
 * - monthly: the anchor day each month from the start month, clamped to shorter months' last day.
 *
 * A `count` end limits the total number of occurrences, including the first. `endBefore` (set when a
 * series is split) stops the series before that date.
 *
 * `from` is a hint that dates before it aren't needed: daily and weekly series jump ahead instead of
 * stepping through every earlier day (indexes stay exact). A few earlier dates may still be yielded.
 */
export function* scheduledDates(
  schedule: Schedule,
  until?: LocalDate,
  from?: LocalDate,
): Generator<ScheduledDate> {
  const { startDate, recurrence, end, endBefore } = schedule
  const limit = recurrence.kind === 'once' ? 1 : end.kind === 'count' ? end.count : MAX_OCCURRENCES
  const withinBounds = (date: LocalDate) =>
    (until === undefined || compareDates(date, until) <= 0) &&
    (endBefore === null || compareDates(date, endBefore) < 0)

  let index = 0
  const next = (date: LocalDate): ScheduledDate => ({ date, index: index++ })

  switch (recurrence.kind) {
    case 'once': {
      if (withinBounds(startDate)) yield next(startDate)
      return
    }
    case 'daily': {
      let date = startDate
      const skip = from === undefined ? 0 : diffDays(startDate, from)
      if (skip > 0) {
        index = skip
        date = from!
      }
      for (; index < limit && withinBounds(date); date = addDays(date, 1)) yield next(date)
      return
    }
    case 'weekly': {
      const days = new Set(recurrence.weekdays)
      if (days.size === 0) return
      let date = startDate
      // Any 7 consecutive days contain each selected weekday exactly once, so whole weeks can be skipped.
      const weeks = from === undefined ? 0 : Math.floor(diffDays(startDate, from) / 7)
      if (weeks > 0) {
        index = weeks * days.size
        date = addDays(startDate, weeks * 7)
      }
      for (; index < limit && withinBounds(date); date = addDays(date, 1)) {
        if (days.has(weekdayOf(date))) yield next(date)
      }
      return
    }
    case 'monthly': {
      const { year, month } = dateParts(startDate)
      for (let monthsAhead = 0; index < limit; monthsAhead++) {
        const date = monthDateClamped(year, month, monthsAhead, recurrence.dayOfMonth)
        if (compareDates(date, startDate) < 0) continue
        if (!withinBounds(date)) return
        yield next(date)
      }
      return
    }
  }
}

/** Scheduled dates within [from, to] (inclusive). */
export function scheduledDatesBetween(schedule: Schedule, from: LocalDate, to: LocalDate): ScheduledDate[] {
  const result: ScheduledDate[] = []
  for (const item of scheduledDates(schedule, to, from)) {
    if (compareDates(item.date, from) >= 0) result.push(item)
  }
  return result
}

/** Whether `date` is one of the series' scheduled dates, and its index if so. */
export function scheduledIndexOf(schedule: Schedule, date: LocalDate): number | null {
  for (const item of scheduledDates(schedule, date)) {
    if (item.date === date) return item.index
  }
  return null
}

/** Number of scheduled dates strictly before `date`. */
export function countScheduledBefore(schedule: Schedule, date: LocalDate): number {
  return Array.from(scheduledDates(schedule, addDays(date, -1))).length
}
