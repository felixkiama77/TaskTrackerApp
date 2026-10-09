import { describe, expect, it } from 'vitest'
import { alertCopy, alertsBetween, missedAlertsCopy, OVERDUE_ALERT_GRACE_MS } from '../../src/domain/alerts'
import { at, dataWith, makeTask } from './helpers'

describe('alert schedule (FR-23, FR-24)', () => {
  const timed = makeTask({
    id: 'timed',
    title: 'Submit the assignment',
    startDate: '2026-10-08',
    dueTime: '17:00',
    reminders: [0, 30],
  })
  const dateOnly = makeTask({ id: 'day', startDate: '2026-10-08', dueTime: null, reminders: [0, 1440] })

  it('fires reminders before the due time, the due alarm at it, and one overdue alert after a grace period', () => {
    const events = alertsBetween(dataWith([timed]), at('2026-10-08', '00:00'), at('2026-10-09', '00:00'))
    expect(events.map((e) => [e.kind, e.at])).toEqual([
      ['reminder', at('2026-10-08', '16:30')],
      ['due', at('2026-10-08', '17:00')],
      ['overdue', at('2026-10-08', '17:00') + OVERDUE_ALERT_GRACE_MS],
    ])
  })

  it('date-only tasks are measured from the date-only reminder time; overdue fires the next morning', () => {
    const events = alertsBetween(dataWith([dateOnly]), at('2026-10-06', '00:00'), at('2026-10-10', '00:00'))
    expect(events.map((e) => [e.kind, e.at])).toEqual([
      ['reminder', at('2026-10-07', '09:00')],
      ['due', at('2026-10-08', '09:00')],
      ['overdue', at('2026-10-09', '09:00')],
    ])
  })

  it('only includes events in the window (after, upTo]', () => {
    const data = dataWith([timed])
    expect(
      alertsBetween(data, at('2026-10-08', '16:30'), at('2026-10-08', '17:00')).map((e) => e.kind),
    ).toEqual(['due'])
  })

  it('produces nothing for completed, skipped or reminder-less occurrences, or when reminders are off', () => {
    const window = [at('2026-10-08', '00:00'), at('2026-10-09', '12:00')] as const
    expect(alertsBetween(dataWith([{ ...timed, completed: { '2026-10-08': 'x' } }]), ...window)).toEqual([])
    expect(
      alertsBetween(dataWith([{ ...timed, exceptions: { '2026-10-08': 'skipped' } }]), ...window),
    ).toEqual([])
    expect(alertsBetween(dataWith([{ ...timed, reminders: [] }]), ...window)).toEqual([])
    const off = dataWith([timed])
    off.settings.remindersEnabled = false
    expect(alertsBetween(off, ...window)).toEqual([])
  })

  it('gives each occurrence’s alerts a stable dedupe key', () => {
    const daily = makeTask({
      id: 'd',
      startDate: '2026-10-08',
      dueTime: '09:00',
      recurrence: { kind: 'daily' },
      end: { kind: 'never' },
      reminders: [15],
    })
    const keys = alertsBetween(dataWith([daily]), at('2026-10-08', '00:00'), at('2026-10-10', '00:00')).map(
      (e) => e.dedupeKey,
    )
    expect(keys).toContain('d|2026-10-08|reminder|15')
    expect(keys).toContain('d|2026-10-09|reminder|15')
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('notification copy (design spec §8)', () => {
  const event = { dedupeKey: '', taskId: '', occurrenceKey: '', at: 0, title: 'Submit the assignment' }

  it('distinguishes reminders, due alarms and overdue alerts', () => {
    expect(alertCopy({ ...event, kind: 'reminder', hasTime: true, leadMinutes: 30 })).toEqual({
      title: 'Task reminder',
      body: '“Submit the assignment” is due in 30 minutes.',
    })
    expect(alertCopy({ ...event, kind: 'reminder', hasTime: true, leadMinutes: 60 }).body).toContain(
      'in 1 hour',
    )
    expect(alertCopy({ ...event, kind: 'reminder', hasTime: false, leadMinutes: 1440 }).body).toContain(
      'due tomorrow',
    )
    expect(alertCopy({ ...event, kind: 'due', hasTime: true, leadMinutes: 0 }).title).toBe('Task due now')
    expect(alertCopy({ ...event, kind: 'overdue', hasTime: true, leadMinutes: 0 })).toEqual({
      title: 'Task overdue',
      body: '“Submit the assignment” is past its due time.',
    })
  })

  it('summarizes missed reminders', () => {
    expect(missedAlertsCopy(1).body).toBe('1 reminder was missed while Task Tracker wasn’t running.')
    expect(missedAlertsCopy(3).body).toBe('3 reminders were missed while Task Tracker wasn’t running.')
  })
})
