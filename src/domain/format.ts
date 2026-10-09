import { dateParts, diffDays, epochAt, localDateOf, type LocalDate, type LocalTime } from './dates'
import type { Recurrence, RecurrenceEnd } from './types'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Human-readable recurrence, e.g. "Every Monday and Thursday, 6 times". */
export function describeRecurrence(recurrence: Recurrence, end: RecurrenceEnd, weekStart = 1): string {
  let text: string
  switch (recurrence.kind) {
    case 'once':
      return 'Does not repeat'
    case 'daily':
      text = 'Every day'
      break
    case 'weekly': {
      const days = [...recurrence.weekdays].sort(
        (a, b) => ((a - weekStart + 7) % 7) - ((b - weekStart + 7) % 7),
      )
      const set = new Set(days)
      if (set.size === 7) text = 'Every day'
      else if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d as 1))) text = 'Every weekday'
      else if (set.size === 2 && set.has(0) && set.has(6)) text = 'Every weekend'
      else text = `Every ${listJoin(days.map((d) => WEEKDAY_NAMES[d]))}`
      break
    }
    case 'monthly':
      text =
        recurrence.dayOfMonth > 28
          ? `Monthly on the ${ordinal(recurrence.dayOfMonth)} (last day in shorter months)`
          : `Monthly on the ${ordinal(recurrence.dayOfMonth)}`
      break
  }
  if (end.kind === 'count') text += end.count === 1 ? ', once' : `, ${end.count} times`
  return text
}

/** Short recurrence label for compact rows, e.g. "Mon, Thu" or "Daily". */
export function shortRecurrence(recurrence: Recurrence, weekStart = 1): string {
  switch (recurrence.kind) {
    case 'once':
      return ''
    case 'daily':
      return 'Daily'
    case 'monthly':
      return `Monthly · ${ordinal(recurrence.dayOfMonth)}`
    case 'weekly': {
      if (recurrence.weekdays.length === 7) return 'Daily'
      const days = [...recurrence.weekdays].sort(
        (a, b) => ((a - weekStart + 7) % 7) - ((b - weekStart + 7) % 7),
      )
      return days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(', ')
    }
  }
}

export function describeReminder(leadMinutes: number, hasTime: boolean): string {
  if (leadMinutes === 0) return hasTime ? 'At due time' : 'On the due date'
  if (leadMinutes % 1440 === 0)
    return leadMinutes === 1440 ? '1 day before' : `${leadMinutes / 1440} days before`
  if (leadMinutes % 60 === 0) return leadMinutes === 60 ? '1 hour before' : `${leadMinutes / 60} hours before`
  return `${leadMinutes} min before`
}

export function formatTime(time: LocalTime, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
    epochAt('2000-01-01', time),
  )
}

/** "Today", "Tomorrow", "Yesterday", or a short date such as "Thu, Oct 9" (with the year if not this year). */
export function formatRelativeDate(date: LocalDate, now: number, locale?: string): string {
  const today = localDateOf(now)
  const delta = diffDays(today, date)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  const { year, month, day } = dateParts(date)
  const sameYear = year === dateParts(today).year
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(new Date(year, month - 1, day))
}

/** Due label such as "Today · 5:00 PM" or "Thu, Oct 9". */
export function formatDue(date: LocalDate, time: LocalTime | null, now: number, locale?: string): string {
  const day = formatRelativeDate(date, now, locale)
  return time === null ? day : `${day} · ${formatTime(time, locale)}`
}

/** Long date, e.g. "Thursday, October 9, 2026". */
export function formatLongDate(date: LocalDate, locale?: string): string {
  const { year, month, day } = dateParts(date)
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(new Date(year, month - 1, day))
}

export function formatTimestamp(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function formatMonthYear(date: LocalDate, locale?: string): string {
  const { year, month } = dateParts(date)
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1),
  )
}

/** Weekday short names starting at `weekStart`, e.g. ["Mon", …, "Sun"]. */
export function weekdayHeaders(
  weekStart: number,
  locale?: string,
): { short: string; long: string; weekday: number }[] {
  // 2026-01-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const weekday = (weekStart + i) % 7
    const date = new Date(2026, 0, 4 + weekday)
    return {
      weekday,
      short: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
      long: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date),
    }
  })
}
