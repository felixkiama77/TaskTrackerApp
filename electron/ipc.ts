import { ipcMain, type IpcMainInvokeEvent, type WebFrameMain } from 'electron'
import { z } from 'zod'
import { applyCommand, CommandError } from '../src/domain/commands'
import { importLegacyData, type LegacyImportReport } from '../src/domain/legacy'
import { CommandSchema, IdSchema, SoundSlotSchema, type Command } from '../src/domain/schemas'
import { assignSound, folderFor, MAX_TRACKS, removeSound } from '../src/domain/sounds'
import type { AppData } from '../src/domain/types'
import {
  Channels,
  type AppInfo,
  type AudioReport,
  type SoundImportResult,
  type DispatchResult,
  type Snapshot,
  type StartupIssue,
  type TestNotificationResult,
} from '../src/shared/api'
import { SoundImportError, type SoundLibrary } from './soundLibrary'
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
  setAudioReport(report: AudioReport): void
  sounds: SoundLibrary
  /** Shows the system file picker; returns chosen paths (empty when cancelled). */
  pickSoundFiles(multiple: boolean): Promise<string[]>
}

const AudioReportSchema = z.object({
  customNotificationSounds: z.array(z.enum(['reminder', 'due', 'overdue', 'missed'])).max(4),
})

const ChooseSoundSchema = z.object({ slot: SoundSlotSchema })
const RemoveSoundSchema = z.object({ slot: SoundSlotSchema, trackId: IdSchema.optional() })

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
  handle(Channels.reportAudio, (_event, payload) => deps.setAudioReport(AudioReportSchema.parse(payload)))

  handle(Channels.chooseSound, async (_event, payload): Promise<SoundImportResult> => {
    const { slot } = ChooseSoundSchema.parse(payload)
    const paths = await deps.pickSoundFiles(slot.kind === 'music')
    if (paths.length === 0) return { cancelled: true, added: 0, errors: [] }
    const errors: string[] = []
    const imported: { file: string; originalName: string }[] = []
    // An effect or notification slot holds one file; extra picks are ignored.
    for (const source of slot.kind === 'music' ? paths : paths.slice(0, 1)) {
      if (slot.kind === 'music' && deps.store.get().sounds.music.length + imported.length >= MAX_TRACKS) {
        errors.push(`You can add up to ${MAX_TRACKS} music tracks.`)
        break
      }
      try {
        imported.push(await deps.sounds.importFile(source, slot))
      } catch (error) {
        if (!(error instanceof SoundImportError)) console.error('[ipc] Sound import failed', error)
        errors.push(error instanceof SoundImportError ? error.message : 'A file couldn’t be added.')
      }
    }
    if (imported.length === 0) return { cancelled: false, added: 0, errors }

    const previous = deps.store.get()
    let sounds = previous.sounds
    const replaced: string[] = []
    const addedAt = new Date(deps.now()).toISOString()
    for (const item of imported) {
      const result = assignSound(sounds, slot, { ...item, addedAt }, deps.newId())
      sounds = result.sounds
      if (result.replacedFile) replaced.push(result.replacedFile)
    }
    const next = { ...previous, sounds }
    try {
      await deps.store.replace(next)
    } catch (error) {
      console.error('[ipc] Could not save sounds', error)
      await Promise.all(imported.map((i) => deps.sounds.deleteFile(folderFor(slot), i.file)))
      return { cancelled: false, added: 0, errors: ['The sounds couldn’t be saved. Please try again.'] }
    }
    await Promise.all(replaced.map((file) => deps.sounds.deleteFile(folderFor(slot), file)))
    deps.onChanged(previous, next, null)
    return { cancelled: false, added: imported.length, errors }
  })

  handle(Channels.removeSound, async (_event, payload): Promise<DispatchResult> => {
    const { slot, trackId } = RemoveSoundSchema.parse(payload)
    const previous = deps.store.get()
    const { sounds, removedFile } = removeSound(previous.sounds, slot, trackId)
    if (!removedFile) return { ok: true, changed: false, message: 'Nothing to remove.' }
    const next = { ...previous, sounds }
    try {
      await deps.store.replace(next)
    } catch (error) {
      console.error('[ipc] Could not save sounds', error)
      return { ok: false, error: 'The sound couldn’t be removed. Please try again.' }
    }
    await deps.sounds.deleteFile(folderFor(slot), removedFile)
    deps.onChanged(previous, next, null)
    return { ok: true, changed: true, message: 'Sound removed.' }
  })
}
