import type { LocalDate, LocalTime, Weekday } from './dates'
import { emptyUserSounds, type UserSounds } from './sounds'

export type Priority = 'low' | 'medium' | 'high'

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
  priority: Priority
  /** Optional free text, e.g. a short summary of the assignment or email a task came from. */
  notes: string
  /** Optional https link, e.g. to the assignment or message. */
  link: string | null
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
  /** Set when the task was added from a suggestions file; `null` for tasks created in the app. */
  source: TaskSource | null
  createdAt: string
  updatedAt: string
}

/** The fields a suggestions file can set, as they were last imported. */
export interface ImportedValues {
  title: string
  notes: string
  link: string | null
  dueDate: LocalDate
  dueTime: LocalTime | null
  priority: Priority
  categoryIds: string[]
  reminders: number[]
}

/**
 * Where an imported task came from. `imported` holds the values from the last import, so a later
 * import can tell a change at the source apart from an edit made in the app (which is never overwritten).
 */
export interface TaskSource {
  /** The system that suggested the task, e.g. "canvas" or "outlook". */
  system: string
  /** Stable id of the item in that system, e.g. "course-123/assignment-456". */
  externalId: string
  /** Name of the routine or file that suggested it, for display. */
  origin: string
  importedAt: string
  imported: ImportedValues
}

export type CompletionClassification = 'early' | 'on-time' | 'overdue' | 'unknown'

/** Historical snapshot of one completed occurrence (FR-19). */
export interface ArchiveRecord {
  id: string
  taskId: string
  occurrenceKey: LocalDate
  title: string
  priority: Priority
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
  /** Play a sound with notifications: the custom sound if one was added, otherwise the system sound. */
  playSound: boolean
  /** 0-1. Volume of custom notification sounds (the system sound uses the system volume). */
  notificationVolume: number
  /** Short sounds for actions such as completing or deleting a task. */
  soundEffects: boolean
  /** 0-1 */
  effectsVolume: number
  /** Background music, played in rotation while the window is open. */
  music: boolean
  /** 0-1 */
  musicVolume: number
  musicShuffle: boolean
  /** Time reminders are measured from for tasks without a due time. */
  dateOnlyReminderTime: LocalTime
  closeBehavior: CloseBehavior
  launchAtLogin: boolean
  weekStart: WeekStartSetting
  showCompletedInCalendar: boolean
}

/** Result of reading one suggestions file, kept so Settings can show what happened. */
export interface ImportReport {
  file: string
  origin: string
  at: string
  /** Set when the file couldn't be read at all; nothing was changed. */
  error: string | null
  created: number
  updated: number
  unchanged: number
  /** Things worth a look: edits of yours that were kept, items skipped and why. */
  notes: string[]
}

export interface ImportState {
  /** Folder that suggestions files are read from; chosen in Settings. */
  folder: string | null
  /**
   * Every source item ever imported ("system:externalId" → first import time), so a task you deleted
   * is never added again.
   */
  seen: Record<string, string>
  /** File name → content hash already processed, so an unchanged file is not read again. */
  files: Record<string, string>
  /** Most recent reports first. */
  reports: ImportReport[]
}

export interface AppData {
  version: 2
  tasks: TaskDefinition[]
  categories: Category[]
  archive: ArchiveRecord[]
  settings: Settings
  /** Sound files the user added in Settings (stored in the app's data folder). */
  sounds: UserSounds
  /** Notification bookkeeping, owned by the main-process scheduler. */
  alerts: {
    /** Dedupe key → epoch ms delivered. */
    delivered: Record<string, number>
    /** Upper bound (epoch ms) of the last scheduler check. */
    lastCheckedAt: number | null
  }
  /** Suggested-task imports (see docs/DECISIONS.md, "School automation"). */
  imports: ImportState
  meta: {
    legacyImportedAt: string | null
  }
}

export const DEFAULT_SETTINGS: Settings = {
  remindersEnabled: true,
  playSound: true,
  notificationVolume: 0.8,
  soundEffects: true,
  effectsVolume: 0.6,
  music: false,
  musicVolume: 0.3,
  musicShuffle: true,
  dateOnlyReminderTime: '09:00',
  closeBehavior: 'tray',
  launchAtLogin: false,
  weekStart: 'locale',
  showCompletedInCalendar: true,
}

export function emptyImportState(): ImportState {
  return { folder: null, seen: {}, files: {}, reports: [] }
}

export function emptyAppData(): AppData {
  return {
    version: 2,
    tasks: [],
    categories: [],
    archive: [],
    settings: { ...DEFAULT_SETTINGS },
    sounds: emptyUserSounds(),
    alerts: { delivered: {}, lastCheckedAt: null },
    imports: emptyImportState(),
    meta: { legacyImportedAt: null },
  }
}

export const PRIORITY_ORDER: Record<Priority, number> = { low: 0, medium: 1, high: 2 }

export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' }

/** Reminder presets offered in the editor, in minutes before the due time. */
export const REMINDER_PRESETS = [0, 5, 15, 30, 60, 120, 360, 720, 1440, 2880] as const

/** Upper limits that keep the app responsive and the data file reasonable. */
export const MAX_TASKS = 2000
export const MAX_CATEGORIES = 200

export const MAX_NOTES_LENGTH = 1000

/** Archive records are removed this long after completion (FR-20). */
export const ARCHIVE_RETENTION_MS = 90 * 86_400_000
