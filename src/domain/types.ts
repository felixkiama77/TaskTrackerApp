import type { LocalDate, LocalTime, Weekday } from './dates'

export type Difficulty = 'easy' | 'medium' | 'hard'

/** How often a task repeats. Weekly covers both "weekly" and "multiple times per week". */
export type Recurrence =
  | { kind: 'once' }
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: Weekday[] }
  /** `dayOfMonth` is the anchor day (1-31); shorter months clamp to their last day. */
  | { kind: 'monthly'; dayOfMonth: number }

/** When a recurring series stops. `count` is the total number of occurrences, including the first. */
export type RecurrenceEnd = { kind: 'never' } | { kind: 'count'; count: number }

/** Why a scheduled occurrence is no longer active (other than completion). */
export type OccurrenceException = 'skipped' | 'detached'

export interface Category {
  id: string
  name: string
  createdAt: string
}

/**
 * A task definition. Occurrences are derived from its schedule rather than stored; per-occurrence
 * state is kept in `completed` and `exceptions`, keyed by the occurrence's original scheduled date.
 */
export interface TaskDefinition {
  id: string
  title: string
  difficulty: Difficulty
  categoryIds: string[]
  /** Due date of the first occurrence. */
  startDate: LocalDate
  /** Optional due time; without one an occurrence is due at the end of its day. */
  dueTime: LocalTime | null
  recurrence: Recurrence
  end: RecurrenceEnd
  /** Set when "this and future" edits split the series: occurrences on or after this date belong to another task. */
  endBefore: LocalDate | null
  /** Reminder lead times in minutes before the due time; 0 is the due-time alarm. */
  reminders: number[]
  /**
   * Completed occurrence keys → completion timestamp (ISO). Kept separately from the archive so an
   * expired archive record never makes a completed occurrence reappear as overdue.
   */
  completed: Record<LocalDate, string>
  exceptions: Record<LocalDate, OccurrenceException>
  createdAt: string
  updatedAt: string
}

export type CompletionClassification = 'early' | 'on-time' | 'overdue' | 'unknown'

/** Historical snapshot of one completed occurrence (FR-19). */
export interface ArchiveRecord {
  id: string
  taskId: string
  occurrenceKey: LocalDate
  title: string
  difficulty: Difficulty
  categoryIds: string[]
  /** Category names at completion time; kept even if the category is later renamed or deleted. */
  categoryNames: string[]
  dueDate: LocalDate
  dueTime: LocalTime | null
  recurrence: Recurrence
  end: RecurrenceEnd
  /** 1-based position of this occurrence in its series. */
  occurrenceNumber: number
  reminders: number[]
  completedAt: string
  /** `unknown` only for tasks imported as already-complete from the legacy app, whose completion time was never recorded. */
  classification: CompletionClassification
}

export type WeekStartSetting = 'locale' | Weekday
export type CloseBehavior = 'tray' | 'quit'

export interface Settings {
  remindersEnabled: boolean
  playSound: boolean
  /** Time reminders are measured from for tasks without a due time. */
  dateOnlyReminderTime: LocalTime
  closeBehavior: CloseBehavior
  launchAtLogin: boolean
  weekStart: WeekStartSetting
  showCompletedInCalendar: boolean
}

export interface AppData {
  version: 1
  tasks: TaskDefinition[]
  categories: Category[]
  archive: ArchiveRecord[]
  settings: Settings
  /** Notification bookkeeping, owned by the main-process scheduler. */
  alerts: {
    /** Dedupe key → epoch ms delivered. */
    delivered: Record<string, number>
    /** Upper bound (epoch ms) of the last scheduler check. */
    lastCheckedAt: number | null
  }
  meta: {
    legacyImportedAt: string | null
  }
}

export const DEFAULT_SETTINGS: Settings = {
  remindersEnabled: true,
  playSound: true,
  dateOnlyReminderTime: '09:00',
  closeBehavior: 'tray',
  launchAtLogin: false,
  weekStart: 'locale',
  showCompletedInCalendar: true,
}

export function emptyAppData(): AppData {
  return {
    version: 1,
    tasks: [],
    categories: [],
    archive: [],
    settings: { ...DEFAULT_SETTINGS },
    alerts: { delivered: {}, lastCheckedAt: null },
    meta: { legacyImportedAt: null },
  }
}

export const DIFFICULTY_ORDER: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 }

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

/** Reminder presets offered in the editor, in minutes before the due time. */
export const REMINDER_PRESETS = [0, 5, 15, 30, 60, 120, 1440, 2880] as const

/** Archive records are removed this long after completion (FR-20). */
export const ARCHIVE_RETENTION_MS = 90 * 86_400_000
