import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  endOfDayEpoch,
  epochAt,
  isValidLocalDate,
  isValidLocalTime,
  localDateOf,
  localeWeekStart,
  localTimeOf,
  monthDateClamped,
  startOfDayEpoch,
  startOfWeek,
  weekdayOf,
} from '../../src/domain/dates'

describe('local date validation', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidLocalDate('2026-10-08')).toBe(true)
    expect(isValidLocalDate('2028-02-29')).toBe(true)
    expect(isValidLocalDate('2026-02-29')).toBe(false)
    expect(isValidLocalDate('2026-13-01')).toBe(false)
    expect(isValidLocalDate('2026-10-8')).toBe(false)
    expect(isValidLocalDate('')).toBe(false)
  })

  it('accepts 24-hour HH:mm times', () => {
    expect(isValidLocalTime('00:00')).toBe(true)
    expect(isValidLocalTime('23:59')).toBe(true)
    expect(isValidLocalTime('24:00')).toBe(false)
    expect(isValidLocalTime('9:00')).toBe(false)
  })
})

describe('calendar arithmetic', () => {
  it('adds days across month, year and daylight-saving boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    // Clocks go back on 2026-11-01 in US Pacific time; the date must still advance by exactly one.
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('measures whole days between dates', () => {
    expect(diffDays('2026-10-08', '2026-10-11')).toBe(3)
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2)
    expect(diffDays('2026-10-11', '2026-10-08')).toBe(-3)
  })

  it('knows month lengths, including leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('clamps monthly anchors to the last day of shorter months', () => {
    expect(monthDateClamped(2026, 1, 0, 31)).toBe('2026-01-31')
    expect(monthDateClamped(2026, 1, 1, 31)).toBe('2026-02-28')
    expect(monthDateClamped(2026, 1, 2, 31)).toBe('2026-03-31')
    expect(monthDateClamped(2026, 1, 3, 31)).toBe('2026-04-30')
    expect(monthDateClamped(2028, 1, 1, 30)).toBe('2028-02-29')
    expect(monthDateClamped(2026, 11, 2, 15)).toBe('2027-01-15')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('reports weekdays and week starts', () => {
    expect(weekdayOf('2026-10-08')).toBe(4) // Thursday
    expect(startOfWeek('2026-10-08', 1)).toBe('2026-10-05') // Monday
    expect(startOfWeek('2026-10-08', 0)).toBe('2026-10-04') // Sunday
    expect(startOfWeek('2026-10-04', 1)).toBe('2026-09-28') // Sunday belongs to the previous Monday week
    expect(startOfWeek('2026-10-05', 1)).toBe('2026-10-05')
  })
})

describe('instants in local time', () => {
  it('converts local date + time to an instant and back', () => {
    const ms = epochAt('2026-10-08', '17:30')
    expect(localDateOf(ms)).toBe('2026-10-08')
    expect(localTimeOf(ms)).toBe('17:30')
  })

  it('resolves a time skipped by spring-forward to the next valid instant', () => {
    // 02:30 does not exist in US Pacific time on 2026-03-08.
    expect(localTimeOf(epochAt('2026-03-08', '02:30'))).toBe('03:30')
  })

  it('ends the day at the last millisecond before the next local midnight, even on DST days', () => {
    expect(endOfDayEpoch('2026-10-08') + 1).toBe(startOfDayEpoch('2026-10-09'))
    // 23-hour and 25-hour days.
    expect(endOfDayEpoch('2026-03-08') - startOfDayEpoch('2026-03-08') + 1).toBe(23 * 3_600_000)
    expect(endOfDayEpoch('2026-11-01') - startOfDayEpoch('2026-11-01') + 1).toBe(25 * 3_600_000)
    expect(localDateOf(endOfDayEpoch('2026-11-01'))).toBe('2026-11-01')
  })
})

describe('locale week start', () => {
  it('uses the locale’s first day of the week and falls back to Monday', () => {
    expect(localeWeekStart('en-US')).toBe(0)
    expect(localeWeekStart('en-GB')).toBe(1)
    expect(localeWeekStart('not a locale!')).toBe(1)
  })
})
