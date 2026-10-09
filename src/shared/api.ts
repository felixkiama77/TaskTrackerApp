import type { LegacyImportReport, LegacyRaw } from '../domain/legacy'
import type { Command } from '../domain/schemas'
import type { AppData } from '../domain/types'

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

export interface TaskTrackerApi {
  getSnapshot(): Promise<Snapshot>
  dispatch(command: Command): Promise<DispatchResult>
  importLegacy(raw: LegacyRaw): Promise<LegacyImportReport>
  testNotification(): Promise<TestNotificationResult>
  getAppInfo(): Promise<AppInfo>
  openDataFolder(): Promise<void>
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void
  onAlert(listener: (alert: AlertMessage) => void): () => void
  onNavigate(listener: (target: NavigateMessage) => void): () => void
}

/** IPC channel names, kept in one place so main and preload cannot drift apart. */
export const Channels = {
  getSnapshot: 'tt:get-snapshot',
  dispatch: 'tt:dispatch',
  importLegacy: 'tt:import-legacy',
  testNotification: 'tt:test-notification',
  getAppInfo: 'tt:get-app-info',
  openDataFolder: 'tt:open-data-folder',
  snapshot: 'tt:snapshot',
  alert: 'tt:alert',
  navigate: 'tt:navigate',
} as const

declare global {
  interface Window {
    taskTracker: TaskTrackerApi
  }
}
