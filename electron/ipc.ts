import { ipcMain, type IpcMainInvokeEvent, type WebFrameMain } from 'electron'
import { z } from 'zod'
import { applyCommand, CommandError } from '../src/domain/commands'
import { importLegacyData, type LegacyImportReport } from '../src/domain/legacy'
import { CommandSchema, type Command } from '../src/domain/schemas'
import type { AppData } from '../src/domain/types'
import {
  Channels,
  type AppInfo,
  type DispatchResult,
  type Snapshot,
  type StartupIssue,
  type TestNotificationResult,
} from '../src/shared/api'
import type { Store } from './store'

/**
 * The only IPC surface the renderer can reach (FR-26). Every handler checks that the request comes
 * from the app's own page and validates its payload before touching any state.
 */
export interface IpcDeps {
  store: Store
  issues: StartupIssue[]
  now: () => number
  newId: () => string
  isTrustedSender(frame: WebFrameMain | null): boolean
  /** Called after a successful change has been saved. */
  onChanged(previous: AppData, next: AppData, command: Command | null): void
  testNotification(): TestNotificationResult
  appInfo(): AppInfo
  openDataFolder(): Promise<void>
}

const LegacyRawSchema = z.object({
  tasks: z.string().max(5_000_000).nullable(),
  tags: z.string().max(5_000_000).nullable(),
})

/** What the renderer sees: everything except the scheduler's delivery log. */
export function snapshotOf(data: AppData, issues: StartupIssue[]): Snapshot {
  return { data: { ...data, alerts: { delivered: {}, lastCheckedAt: data.alerts.lastCheckedAt } }, issues }
}

export function registerIpc(deps: IpcDeps) {
  const handle = <T>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, payload: unknown) => Promise<T> | T,
  ) => {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (!deps.isTrustedSender(event.senderFrame)) {
        console.warn(`[ipc] Rejected ${channel} from untrusted sender ${event.senderFrame?.url ?? 'unknown'}`)
        throw new Error('Untrusted sender.')
      }
      return handler(event, payload)
    })
  }

  handle(Channels.getSnapshot, () => snapshotOf(deps.store.get(), deps.issues))

  handle(Channels.dispatch, async (_event, payload): Promise<DispatchResult> => {
    const parsed = CommandSchema.safeParse(payload)
    if (!parsed.success) {
      console.warn('[ipc] Invalid command:', parsed.error.issues.slice(0, 3))
      return { ok: false, error: 'That request wasn’t valid, so nothing was changed.' }
    }
    const previous = deps.store.get()
    let result
    try {
      result = applyCommand(previous, parsed.data, { now: deps.now(), newId: deps.newId })
    } catch (error) {
      if (error instanceof CommandError) return { ok: false, error: error.message }
      console.error('[ipc] Command failed:', parsed.data.type, error)
      return { ok: false, error: 'Something went wrong, so nothing was changed.' }
    }
    if (!result.changed) return { ok: true, changed: false, message: result.message }
    try {
      await deps.store.replace(result.data)
    } catch (error) {
      console.error('[ipc] Could not save:', error)
      return {
        ok: false,
        error: 'Your change couldn’t be saved to disk, so it was undone. Please try again.',
      }
    }
    deps.onChanged(previous, result.data, parsed.data)
    return { ok: true, changed: true, message: result.message }
  })

  handle(Channels.importLegacy, async (_event, payload): Promise<LegacyImportReport> => {
    const raw = LegacyRawSchema.parse(payload)
    const previous = deps.store.get()
    const { data, report } = importLegacyData(previous, raw, { now: deps.now(), newId: deps.newId })
    if (data !== previous) {
      await deps.store.replace(data)
      deps.onChanged(previous, data, null)
    }
    return report
  })

  handle(Channels.testNotification, () => deps.testNotification())
  handle(Channels.getAppInfo, () => deps.appInfo())
  handle(Channels.openDataFolder, () => deps.openDataFolder())
}
