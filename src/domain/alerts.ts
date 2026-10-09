import { addDays, epochAt, localDateOf } from './dates'
import { occurrencesBetween, type Occurrence } from './occurrences'
import type { AppData, Settings } from './types'

/**
 * Reminder, due-time and overdue alerts (FR-23–FR-25).
 *
 * - reminder: `lead` minutes before the due time.
 * - due: at the due time (the "At due time" reminder preset, lead 0).
 * - overdue: once per occurrence — 15 minutes after a timed deadline, or the morning after a
 *   date-only due date (at the date-only reminder time) so nobody is woken at midnight.
 *
 * Tasks without a due time measure reminders from `settings.dateOnlyReminderTime` on the due date.
 * Only tasks with at least one reminder get alerts; everything else shows its status in the app.
 */
export type AlertKind = 'reminder' | 'due' | 'overdue'

export interface AlertEvent {
  /** Stable identity: task + occurrence + kind + lead. Used to prevent duplicate delivery. */
  dedupeKey: string
  kind: AlertKind
  at: number
  taskId: string
  occurrenceKey: string
  title: string
  hasTime: boolean
  leadMinutes: number
}

export const OVERDUE_ALERT_GRACE_MS = 15 * 60_000
/** Longest reminder lead time offered (2 days), in days, plus one for the overdue alert. */
const SCAN_AHEAD_DAYS = 3

function anchorOf(occ: Occurrence, settings: Settings): number {
  return occ.dueTime === null ? epochAt(occ.date, settings.dateOnlyReminderTime) : occ.dueAt
}

export function alertsForOccurrence(occ: Occurrence, settings: Settings): AlertEvent[] {
  const { task } = occ
  if (occ.state !== 'active' || task.reminders.length === 0) return []
  const base = {
    taskId: task.id,
    occurrenceKey: occ.key,
    title: task.title,
    hasTime: occ.dueTime !== null,
  }
  const anchor = anchorOf(occ, settings)
  const events: AlertEvent[] = task.reminders.map((lead) => {
    const kind: AlertKind = lead === 0 ? 'due' : 'reminder'
    return {
      ...base,
      kind,
      leadMinutes: lead,
      at: anchor - lead * 60_000,
      dedupeKey: `${task.id}|${occ.key}|${kind}|${lead}`,
    }
  })
  const overdueAt =
    occ.dueTime === null
      ? epochAt(addDays(occ.date, 1), settings.dateOnlyReminderTime)
      : occ.dueAt + OVERDUE_ALERT_GRACE_MS
  events.push({
    ...base,
    kind: 'overdue',
    leadMinutes: 0,
    at: overdueAt,
    dedupeKey: `${task.id}|${occ.key}|overdue|0`,
  })
  return events
}

/** Alerts due in the window (after, upTo], oldest first. Disabled reminders produce none. */
export function alertsBetween(data: AppData, after: number, upTo: number): AlertEvent[] {
  if (!data.settings.remindersEnabled || upTo <= after) return []
  // Overdue alerts can fire up to a day after the due date; reminders up to two days before it.
  const from = addDays(localDateOf(after), -1)
  const to = addDays(localDateOf(upTo), SCAN_AHEAD_DAYS)
  const events: AlertEvent[] = []
  for (const task of data.tasks) {
    if (task.reminders.length === 0) continue
    for (const occ of occurrencesBetween(task, from, to)) {
      for (const event of alertsForOccurrence(occ, data.settings)) {
        if (event.at > after && event.at <= upTo) events.push(event)
      }
    }
  }
  return events.sort((a, b) => a.at - b.at || a.dedupeKey.localeCompare(b.dedupeKey))
}

function formatLead(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? '1 day' : `${minutes / 1440} days`
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/** Notification title and body for an alert (design spec §8 copy). */
export function alertCopy(event: AlertEvent): { title: string; body: string } {
  const name = `“${event.title}”`
  switch (event.kind) {
    case 'reminder':
      if (event.hasTime)
        return { title: 'Task reminder', body: `${name} is due in ${formatLead(event.leadMinutes)}.` }
      if (event.leadMinutes < 1440) return { title: 'Task reminder', body: `${name} is due today.` }
      if (event.leadMinutes < 2880) return { title: 'Task reminder', body: `${name} is due tomorrow.` }
      return { title: 'Task reminder', body: `${name} is due in ${formatLead(event.leadMinutes)}.` }
    case 'due':
      return event.hasTime
        ? { title: 'Task due now', body: `${name} is due now.` }
        : { title: 'Task due today', body: `${name} is due today.` }
    case 'overdue':
      return event.hasTime
        ? { title: 'Task overdue', body: `${name} is past its due time.` }
        : { title: 'Task overdue', body: `${name} was due yesterday.` }
  }
}

export function missedAlertsCopy(count: number): { title: string; body: string } {
  return {
    title: 'Missed reminders',
    body:
      count === 1
        ? '1 reminder was missed while Task Tracker wasn’t running.'
        : `${count} reminders were missed while Task Tracker wasn’t running.`,
  }
}
