import type { LegacyImportReport, LegacyRaw } from '../domain/legacy'
import type { CommandInput } from '../domain/schemas'
import type { SoundSlot } from '../domain/sounds'
import type { AppData, ImportReport } from '../domain/types'

/**
 * The contract between the renderer and the main process. The preload script exposes exactly this
 * object as `window.taskTracker`; nothing else from Electron or Node reaches the page.
 */

/** Something that went wrong while loading saved data, shown to the user once. */
export interface StartupIssue {
  kind: 'restored-from-backup' | 'reset' | 'quarantined'
  message: string
}

export interface Snapshot {
  data: AppData
  issues: StartupIssue[]
}

export type DispatchResult = { ok: true; changed: boolean; message: string } | { ok: false; error: string }

/** An alert the main process just delivered, mirrored in the window as a toast and edge pulse. */
export interface AlertMessage {
  kind: 'reminder' | 'due' | 'overdue' | 'missed'
  title: string
  body: string
  taskId?: string
  occurrenceKey?: string
}

/** Sent when the user clicks a notification for a specific occurrence. */
export interface NavigateMessage {
  taskId: string
  occurrenceKey: string
}

export interface AppInfo {
  version: string
  dataDirectory: string
  platform: string
  /** Added to `Date.now()` so the renderer and main process share one clock (non-zero only in tests). */
  clockOffsetMs: number
  notificationsSupported: boolean
  isPackaged: boolean
}

export type TestNotificationResult = { ok: true } | { ok: false; error: string }

/** Result of choosing sound files in Settings. */
export interface SoundImportResult {
  cancelled: boolean
  added: number
  /** One message per file that couldn't be used. */
  errors: string[]
}

/** Which notification kinds have a custom sound in this build (their system sound is then muted). */
export interface AudioReport {
  customNotificationSounds: ('reminder' | 'due' | 'overdue' | 'missed')[]
}

/** State of the suggested-task folder. Kept in memory by the main process, not in the data file. */
export interface ImportStatus {
  folder: string | null
  /** When the folder was last checked in this session (ISO), or `null` if not yet. */
  lastCheckedAt: string | null
  /** Why the folder couldn't be read at the last check; `null` if it could. */
  folderError: string | null
}

/** Sent after every folder check; `reports` covers only files that changed. */
export interface ImportCheckedMessage {
  status: ImportStatus
  reports: ImportReport[]
}

export interface TaskTrackerApi {
  getSnapshot(): Promise<Snapshot>
  dispatch(command: CommandInput): Promise<DispatchResult>
  importLegacy(raw: LegacyRaw): Promise<LegacyImportReport>
  testNotification(): Promise<TestNotificationResult>
  getAppInfo(): Promise<AppInfo>
  openDataFolder(): Promise<void>
  reportAudio(report: AudioReport): Promise<void>
  /** Opens the system file picker (several files for music) and adds the chosen sounds. */
  chooseSound(slot: SoundSlot): Promise<SoundImportResult>
  removeSound(slot: SoundSlot, trackId?: string): Promise<DispatchResult>
  getImportStatus(): Promise<ImportStatus>
  /** Opens the system folder picker; the chosen folder is checked straight away. */
  chooseImportFolder(): Promise<{ cancelled: boolean; status: ImportStatus }>
  clearImportFolder(): Promise<ImportStatus>
  checkImportsNow(): Promise<ImportCheckedMessage>
  /** Opens a task's link in the default browser. Only https links stored on the task are opened. */
  openTaskLink(taskId: string): Promise<boolean>
  onImportChecked(listener: (message: ImportCheckedMessage) => void): () => void
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void
  onAlert(listener: (alert: AlertMessage) => void): () => void
  onNavigate(listener: (target: NavigateMessage) => void): () => void
  /** Whether the window is actually on screen (Chromium still reports "visible" when hidden to the tray). */
  onWindowVisibility(listener: (shown: boolean) => void): () => void
}

/** IPC channel names, kept in one place so main and preload cannot drift apart. */
export const Channels = {
  getSnapshot: 'tt:get-snapshot',
  dispatch: 'tt:dispatch',
  importLegacy: 'tt:import-legacy',
  testNotification: 'tt:test-notification',
  getAppInfo: 'tt:get-app-info',
  openDataFolder: 'tt:open-data-folder',
  reportAudio: 'tt:report-audio',
  chooseSound: 'tt:choose-sound',
  removeSound: 'tt:remove-sound',
  getImportStatus: 'tt:get-import-status',
  chooseImportFolder: 'tt:choose-import-folder',
  clearImportFolder: 'tt:clear-import-folder',
  checkImportsNow: 'tt:check-imports-now',
  openTaskLink: 'tt:open-task-link',
  importChecked: 'tt:import-checked',
  snapshot: 'tt:snapshot',
  alert: 'tt:alert',
  navigate: 'tt:navigate',
  windowVisibility: 'tt:window-visibility',
} as const

declare global {
  interface Window {
    taskTracker: TaskTrackerApi
  }
}
