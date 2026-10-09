/**
 * Local calendar dates and times.
 *
 * A `LocalDate` ("YYYY-MM-DD") is a calendar day in the user's time zone, never an instant. Calendar
 * arithmetic is done on its numeric parts through UTC so daylight-saving transitions cannot shift a
 * date. Only when a date is combined with a time do we convert to an epoch instant, in local time.
 */

/** Calendar date in local time, "YYYY-MM-DD". */
export type LocalDate = string
/** Wall-clock time in local time, "HH:mm" (24-hour). */
export type LocalTime = string
/** Day of week, 0 = Sunday … 6 = Saturday (same as `Date#getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAY_MS = 86_400_000

export function isValidLocalDate(value: string): boolean {
  const match = DATE_RE.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return y >= 1970 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

export function isValidLocalTime(value: string): boolean {
  return TIME_RE.test(value)
}

export function dateParts(date: LocalDate): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(date)
  if (!match) throw new RangeError(`Invalid local date: ${date}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

export function timeParts(time: LocalTime): { hours: number; minutes: number } {
  const match = TIME_RE.exec(time)
  if (!match) throw new RangeError(`Invalid local time: ${time}`)
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Number of days in a month (month is 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toUtcDay(date: LocalDate): number {
  const { year, month, day } = dateParts(date)
  return Date.UTC(year, month - 1, day)
}

function fromUtcDay(ms: number): LocalDate {
  const d = new Date(ms)
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcDay(toUtcDay(date) + days * DAY_MS)
}

/** Whole calendar days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcDay(b) - toUtcDay(a)) / DAY_MS)
}

export function weekdayOf(date: LocalDate): Weekday {
  return new Date(toUtcDay(date)).getUTCDay() as Weekday
}

/**
 * The date `monthsAhead` months after (year, month) on `anchorDay`, clamped to the last day of
 * shorter months: anchor 31 → Feb 28/29, Apr 30.
 */
export function monthDateClamped(
  year: number,
  month: number,
  monthsAhead: number,
  anchorDay: number,
): LocalDate {
  const index = year * 12 + (month - 1) + monthsAhead
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return formatLocalDate(y, m, Math.min(anchorDay, daysInMonth(y, m)))
}

/** First day of the week containing `date`, for a week starting on `weekStart`. */
export function startOfWeek(date: LocalDate, weekStart: Weekday): LocalDate {
  const offset = (weekdayOf(date) - weekStart + 7) % 7
  return addDays(date, -offset)
}

export function startOfMonth(date: LocalDate): LocalDate {
  const { year, month } = dateParts(date)
  return formatLocalDate(year, month, 1)
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = dateParts(date)
  return monthDateClamped(year, month, months, day)
}

/** The local calendar date of an epoch instant. */
export function localDateOf(epochMs: number): LocalDate {
  const d = new Date(epochMs)
  return formatLocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** "HH:mm" of an epoch instant in local time. */
export function localTimeOf(epochMs: number): LocalTime {
  const d = new Date(epochMs)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Epoch instant of a local date at a local time. A wall-clock time skipped by a daylight-saving
 * jump resolves to the next valid instant (JavaScript's built-in behavior).
 */
export function epochAt(date: LocalDate, time: LocalTime): number {
  const { year, month, day } = dateParts(date)
  const { hours, minutes } = timeParts(time)
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime()
}

/** Epoch instant of local midnight at the start of `date`. */
export function startOfDayEpoch(date: LocalDate): number {
  const { year, month, day } = dateParts(date)
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

/** Last millisecond of `date` in local time (23:59:59.999, or earlier on a short DST day). */
export function endOfDayEpoch(date: LocalDate): number {
  return startOfDayEpoch(addDays(date, 1)) - 1
}

/** Compares two local dates; "YYYY-MM-DD" strings sort chronologically. */
export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

interface WeekInfo {
  firstDay: number
}

/**
 * First day of the week for a locale, as a `Weekday`. Uses `Intl.Locale` week info where the runtime
 * supports it (it reports 1 = Monday … 7 = Sunday) and falls back to Monday.
 */
export function localeWeekStart(locale: string): Weekday {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo }
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return (info.firstDay % 7) as Weekday
  } catch {
    // Unknown locale tag: fall through to the default.
  }
  return 1
}
