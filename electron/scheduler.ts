import { alertCopy, alertsBetween, missedAlertsCopy, type AlertEvent } from '../src/domain/alerts'
import type { AppData } from '../src/domain/types'
import type { AlertMessage } from '../src/shared/api'

/**
 * Delivers reminder, due-time and overdue alerts (FR-22–FR-26).
 *
 * Every check covers the window since the previous check, so nothing falls between ticks, and each
 * alert's dedupe key is recorded once delivered, so restarts, repeated checks and clock changes
 * never deliver it twice. Alerts that became due more than `LATE_AFTER_MS` ago (the app was closed,
 * or the computer was asleep) are not replayed one by one; they are summarized in one notification.
 */
export interface NotificationRequest {
  title: string
  body: string
  taskId?: string
  occurrenceKey?: string
}

export interface Notifier {
  /** Shows a native notification; returns false if it could not be shown. */
  show(request: NotificationRequest): boolean
}

export interface SchedulerDeps {
  getData(): AppData
  saveAlerts(alerts: AppData['alerts']): Promise<void>
  notifier: Notifier
  /** Mirrors delivered alerts into the window (toast + edge pulse). */
  onAlert(message: AlertMessage): void
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

/** Alerts more than this overdue at check time count as missed. */
export const LATE_AFTER_MS = 2 * 60_000
/** Missed alerts are only looked for this far back. */
export const MAX_LOOKBACK_MS = 7 * 86_400_000
/** Upper bound between checks; checks also run exactly when the next alert is due. */
export const MAX_TICK_MS = 30_000
/**
 * How often the check time is saved when nothing was delivered. Deliveries are always saved at once,
 * so a slightly stale check time on disk can only widen the next window, never cause repeats.
 */
export const PERSIST_EVERY_MS = 5 * 60_000

export class ReminderScheduler {
  private timer: unknown = null
  private running = false
  private checking: Promise<void> | null = null
  /** End of the last checked window; starts from what was saved. */
  private lastChecked: number | null = null
  private lastPersisted = -Infinity
  private loaded = false

  constructor(private readonly deps: SchedulerDeps) {}

  start() {
    this.running = true
    void this.check()
  }

  stop() {
    this.running = false
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    this.timer = null
  }

  /** Runs a check now (also used after edits, resume from sleep and clock changes). */
  check(): Promise<void> {
    // Checks never overlap; a request during a check runs right after it. A failed check is logged
    // and the next one is still scheduled, so one bad record can never stop all reminders.
    this.checking = (this.checking ?? Promise.resolve())
      .then(() => this.runCheck())
      .catch((error: unknown) => {
        console.error('[scheduler] Check failed:', error)
        this.scheduleNext(this.deps.now())
      })
    return this.checking
  }

  private async runCheck() {
    const now = this.deps.now()
    const data = this.deps.getData()
    if (!this.loaded) {
      this.lastChecked = data.alerts.lastCheckedAt
      this.loaded = true
    }
    const last = this.lastChecked
    const delivered = { ...data.alerts.delivered }
    let deliveredAny = false

    // First run, or the clock moved backwards: start counting from now. Delivered keys still
    // protect against repeating anything already shown.
    if (last !== null && last <= now) {
      const events = alertsBetween(data, Math.max(last, now - MAX_LOOKBACK_MS), now).filter(
        (event) => delivered[event.dedupeKey] === undefined,
      )
      const missed: AlertEvent[] = []
      for (const event of events) {
        delivered[event.dedupeKey] = now
        deliveredAny = true
        if (now - event.at > LATE_AFTER_MS) {
          missed.push(event)
          continue
        }
        const copy = alertCopy(event)
        this.deps.notifier.show({ ...copy, taskId: event.taskId, occurrenceKey: event.occurrenceKey })
        this.deps.onAlert({
          kind: event.kind,
          ...copy,
          taskId: event.taskId,
          occurrenceKey: event.occurrenceKey,
        })
      }
      if (missed.length > 0) {
        const copy = missedAlertsCopy(missed.length)
        this.deps.notifier.show(copy)
        this.deps.onAlert({ kind: 'missed', ...copy })
      }
    }

    this.lastChecked = now
    if (deliveredAny || last === null || now - this.lastPersisted >= PERSIST_EVERY_MS) {
      try {
        await this.deps.saveAlerts({ delivered, lastCheckedAt: now })
        this.lastPersisted = now
      } catch (error) {
        console.error('[scheduler] Could not save alert state:', error)
      }
    }
    this.scheduleNext(now)
  }

  private scheduleNext(now: number) {
    if (!this.running) return
    if (this.timer !== null) this.deps.clearTimer(this.timer)
    let delay = MAX_TICK_MS
    try {
      const upcoming = alertsBetween(this.deps.getData(), now, now + MAX_TICK_MS)[0]
      if (upcoming) delay = Math.max(0, upcoming.at - now) + 50
    } catch (error) {
      // Fall back to the regular tick; the next check logs the problem again if it persists.
      console.error('[scheduler] Could not work out the next alert time:', error)
    }
    this.timer = this.deps.setTimer(() => {
      this.timer = null
      void this.check()
    }, delay)
  }
}
