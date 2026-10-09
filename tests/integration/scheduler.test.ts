import { describe, expect, it } from 'vitest'
import {
  LATE_AFTER_MS,
  MAX_TICK_MS,
  ReminderScheduler,
  type NotificationRequest,
} from '../../electron/scheduler'
import type { AppData } from '../../src/domain/types'
import type { AlertMessage } from '../../src/shared/api'
import { at, dataWith, makeTask } from '../unit/helpers'

/** A scheduler wired to a fake clock, fake timers and recording notifier. */
function harness(initial: AppData, start: number, options: { notifierWorks?: boolean } = {}) {
  const state = { data: structuredClone(initial), now: start }
  const shown: NotificationRequest[] = []
  const inApp: AlertMessage[] = []
  const timers: { callback: () => void; due: number }[] = []
  const scheduler = new ReminderScheduler({
    getData: () => state.data,
    saveAlerts: (alerts) => {
      state.data = { ...state.data, alerts }
      return Promise.resolve()
    },
    notifier: {
      show: (request) => {
        shown.push(request)
        return options.notifierWorks ?? true
      },
    },
    onAlert: (message) => inApp.push(message),
    now: () => state.now,
    setTimer: (callback, ms) => {
      const timer = { callback, due: state.now + ms }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => {
      const i = timers.indexOf(handle as (typeof timers)[number])
      if (i >= 0) timers.splice(i, 1)
    },
  })
  return {
    state,
    shown,
    inApp,
    timers,
    scheduler,
    /** Moves the clock forward, firing timers in order, as a running app would. */
    async advanceTo(time: number) {
      for (;;) {
        timers.sort((a, b) => a.due - b.due)
        const next = timers[0]
        if (!next || next.due > time) break
        timers.shift()
        state.now = next.due
        next.callback()
        await scheduler.check() // wait for the triggered check to settle
      }
      state.now = time
    },
  }
}

const task = makeTask({
  id: 't',
  title: 'Submit the assignment',
  startDate: '2026-10-08',
  dueTime: '17:00',
  reminders: [30, 0],
})

describe('ReminderScheduler (FR-23 – FR-26)', () => {
  it('on first run only records the check time and delivers nothing', async () => {
    const h = harness(dataWith([task]), at('2026-10-08', '18:00'))
    await h.scheduler.check()
    expect(h.shown).toEqual([])
    expect(h.state.data.alerts.lastCheckedAt).toBe(at('2026-10-08', '18:00'))
  })

  it('delivers each alert once, at its time, while the app runs', async () => {
    const h = harness(dataWith([task]), at('2026-10-08', '16:00'))
    h.scheduler.start()
    await h.scheduler.check()
    await h.advanceTo(at('2026-10-08', '17:30'))
    expect(h.shown.map((n) => n.title)).toEqual(['Task reminder', 'Task due now', 'Task overdue'])
    expect(h.shown[0]).toMatchObject({ body: '“Submit the assignment” is due in 30 minutes.', taskId: 't' })
    expect(h.inApp.map((m) => m.kind)).toEqual(['reminder', 'due', 'overdue'])

    // Extra checks (e.g. after edits or wake-ups) do not repeat anything.
    await h.scheduler.check()
    await h.scheduler.check()
    expect(h.shown).toHaveLength(3)
  })

  it('wakes up exactly when the next alert is due rather than waiting for the next tick', async () => {
    const h = harness(dataWith([task]), at('2026-10-08', '16:29') + 59_000)
    h.scheduler.start()
    await h.scheduler.check()
    const next = h.timers.sort((a, b) => a.due - b.due)[0]
    expect(next.due - h.state.now).toBeLessThan(MAX_TICK_MS)
    expect(next.due).toBeGreaterThanOrEqual(at('2026-10-08', '16:30'))
  })

  it('does not repeat alerts after a restart', async () => {
    const first = harness(dataWith([task]), at('2026-10-08', '16:00'))
    await first.scheduler.check()
    first.state.now = at('2026-10-08', '16:31')
    await first.scheduler.check()
    expect(first.shown).toHaveLength(1)

    const restarted = harness(first.state.data, at('2026-10-08', '16:31'))
    await restarted.scheduler.check()
    expect(restarted.shown).toEqual([])
  })

  it('summarizes alerts missed while the app was closed in a single notification', async () => {
    const h = harness(dataWith([task]), at('2026-10-08', '09:00'))
    await h.scheduler.check()
    // The app is closed until the evening: all three alerts were missed.
    h.state.now = at('2026-10-08', '21:00')
    await h.scheduler.check()
    expect(h.shown).toEqual([
      { title: 'Missed reminders', body: '3 reminders were missed while Task Tracker wasn’t running.' },
    ])
    expect(h.inApp.map((m) => m.kind)).toEqual(['missed'])
    await h.scheduler.check()
    expect(h.shown).toHaveLength(1)
  })

  it('delivers an alert normally if it is only slightly late (e.g. a short sleep)', async () => {
    const h = harness(dataWith([task]), at('2026-10-08', '16:00'))
    await h.scheduler.check()
    h.state.now = at('2026-10-08', '16:30') + LATE_AFTER_MS - 1000
    await h.scheduler.check()
    expect(h.shown.map((n) => n.title)).toEqual(['Task reminder'])
  })

  it('never repeats alerts when the clock moves backwards', async () => {
    const h = harness(dataWith([task]), at('2026-10-08', '16:00'))
    await h.scheduler.check()
    h.state.now = at('2026-10-08', '16:31')
    await h.scheduler.check()
    h.state.now = at('2026-10-08', '16:10') // clock set back
    await h.scheduler.check()
    h.state.now = at('2026-10-08', '16:35')
    await h.scheduler.check()
    expect(h.shown.map((n) => n.title)).toEqual(['Task reminder'])
  })

  it('sends nothing for completed or deleted occurrences, or when reminders are turned off', async () => {
    const completed = harness(
      dataWith([{ ...task, completed: { '2026-10-08': 'x' } }]),
      at('2026-10-08', '16:00'),
    )
    await completed.scheduler.check()
    completed.state.now = at('2026-10-08', '17:30')
    await completed.scheduler.check()
    expect(completed.shown).toEqual([])

    const deleted = harness(dataWith([task]), at('2026-10-08', '16:00'))
    await deleted.scheduler.check()
    deleted.state.data = { ...deleted.state.data, tasks: [] }
    deleted.state.now = at('2026-10-08', '17:30')
    await deleted.scheduler.check()
    expect(deleted.shown).toEqual([])

    const off = dataWith([task])
    off.settings.remindersEnabled = false
    const disabled = harness(off, at('2026-10-08', '16:00'))
    await disabled.scheduler.check()
    disabled.state.now = at('2026-10-08', '17:30')
    await disabled.scheduler.check()
    expect(disabled.shown).toEqual([])
  })

  it('keeps checking after a check fails, so one bad record cannot stop all reminders', async () => {
    const h = harness(dataWith([task]), at('2026-10-08', '16:00'))
    h.scheduler.start()
    await h.scheduler.check()
    const realData = h.state.data
    // Simulate a check that throws (e.g. unreadable data), then recovery.
    Object.defineProperty(h.state, 'data', {
      configurable: true,
      get: () => {
        throw new Error('boom')
      },
    })
    h.state.now = at('2026-10-08', '16:10')
    await expect(h.scheduler.check()).resolves.toBeUndefined()
    expect(h.timers.length).toBeGreaterThan(0) // the next check is still scheduled
    Object.defineProperty(h.state, 'data', { configurable: true, writable: true, value: realData })
    await h.advanceTo(at('2026-10-08', '16:31'))
    expect(h.shown.map((n) => n.title)).toEqual(['Task reminder'])
  })

  it('keeps working when the OS refuses a notification, and still shows the in-app alert', async () => {
    const h = harness(dataWith([task]), at('2026-10-08', '16:00'), { notifierWorks: false })
    await h.scheduler.check()
    h.state.now = at('2026-10-08', '16:30')
    await expect(h.scheduler.check()).resolves.toBeUndefined()
    expect(h.inApp.map((m) => m.kind)).toEqual(['reminder'])
  })
})
