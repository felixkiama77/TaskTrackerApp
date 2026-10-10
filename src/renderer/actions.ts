import { formatLongDate } from '../domain/format'
import { overdueOccurrences, type Occurrence } from '../domain/occurrences'
import type { Command, CommandInput } from '../domain/schemas'
import type { SoundSlot } from '../domain/sounds'
import type { ImportReport } from '../domain/types'
import type { DispatchResult, SoundImportResult, TaskTrackerApi } from '../shared/api'
import type { EffectCue } from './audio/catalog'
import type { SoundPlayer } from './audio/player'
import { clock } from './clock'
import { chooseDialog, confirmDialog } from './components/dialog'
import type { ToastOptions, Toaster } from './components/toast'
import { motionDelay } from './dom'
import { state } from './state'
import { openOccurrenceDetail } from './views/detail'
import { openTaskEditor } from './views/editor'

/** The sound effect for each kind of successful change (others are silent). */
const EFFECT_FOR: Partial<Record<Command['type'], EffectCue>> = {
  'task/create': 'task-created',
  'occurrence/complete': 'task-completed',
  'occurrence/uncomplete': 'task-undone',
  'occurrence/restore': 'task-undone',
  'task/delete': 'task-deleted',
  'occurrence/skip': 'task-skipped',
  'task/skipMissed': 'task-skipped',
}

/**
 * Every user action goes through here: it sends a validated command to the main process and gives
 * clear feedback (FR-37). Errors are always shown as text; animations are only a bonus.
 */
export class Actions {
  constructor(
    private readonly api: TaskTrackerApi,
    private readonly toaster: Toaster,
    readonly sounds: SoundPlayer,
  ) {}

  now = () => clock.now()

  toast(options: ToastOptions) {
    return this.toaster.show(options)
  }

  async dispatch(command: CommandInput, options: { quiet?: boolean } = {}): Promise<DispatchResult> {
    let result: DispatchResult
    try {
      result = await this.api.dispatch(command)
    } catch (error) {
      console.error('[actions] dispatch failed', error)
      result = {
        ok: false,
        error:
          'Task Tracker couldn’t complete that action. Please try again, or restart the app if it keeps happening.',
      }
    }
    if (!result.ok && !options.quiet)
      this.toast({ tone: 'error', title: 'Something went wrong', body: result.error })
    // Sound is an extra cue only; the toast or the changed screen always says what happened.
    const cue = result.ok ? (result.changed ? EFFECT_FOR[command.type] : undefined) : 'error'
    if (cue) this.sounds.playEffect(cue)
    return result
  }

  createTask() {
    openTaskEditor({ mode: 'create' }, this)
  }

  editOccurrence(occ: Occurrence) {
    openTaskEditor({ mode: 'edit', occ }, this)
  }

  openDetail(occ: Occurrence) {
    openOccurrenceDetail(occ, this)
  }

  /** Completes with a short animation (checkbox fills, row slides out), then offers Undo (FR-17). */
  async completeOccurrence(occ: Occurrence, row?: HTMLElement, check?: HTMLButtonElement) {
    if (check) {
      if (check.getAttribute('aria-checked') === 'true') return // already in progress
      check.setAttribute('aria-checked', 'true')
      check.disabled = true
    }
    if (row) {
      await motionDelay(160)
      row.classList.add('is-leaving')
      await motionDelay(200)
    }
    const result = await this.dispatch({ type: 'occurrence/complete', taskId: occ.taskId, key: occ.key })
    if (!result.ok) {
      row?.classList.remove('is-leaving')
      if (check) {
        check.setAttribute('aria-checked', 'false')
        check.disabled = false
      }
      return
    }
    this.toast({
      tone: 'success',
      title: 'Task completed',
      body: `“${occ.task.title}” moved to Completed.`,
      duration: 6000,
      actions: [
        {
          label: 'Undo',
          onClick: () => {
            void this.dispatch({ type: 'occurrence/uncomplete', taskId: occ.taskId, key: occ.key }).then(
              (r) => {
                if (r.ok) this.toast({ tone: 'info', title: 'Completion undone' })
              },
            )
          },
        },
      ],
    })
  }

  async skipOccurrence(occ: Occurrence) {
    const result = await this.dispatch({ type: 'occurrence/skip', taskId: occ.taskId, key: occ.key })
    if (result.ok) this.offerRestore(occ, 'Occurrence skipped')
  }

  async skipAllMissed(taskId: string) {
    const result = await this.dispatch({ type: 'task/skipMissed', taskId })
    if (result.ok) this.toast({ tone: 'success', title: result.message })
  }

  /** Deletes after confirmation; recurring tasks offer one occurrence or the whole series (FR-16). */
  async deleteOccurrence(occ: Occurrence) {
    const { task } = occ
    if (task.recurrence.kind === 'once') {
      const ok = await confirmDialog({
        title: 'Delete task?',
        message: `“${task.title}” will be deleted and its reminders cancelled. Completed history is kept.`,
        confirmLabel: 'Delete task',
        danger: true,
      })
      if (!ok) return
      const result = await this.dispatch({ type: 'task/delete', taskId: task.id, scope: { kind: 'series' } })
      if (result.ok) this.toast({ tone: 'success', title: 'Task deleted' })
      return
    }
    const scope = await chooseDialog<'occurrence' | 'series'>({
      title: 'Delete a repeating task',
      message: `“${task.title}” repeats. Completed history is kept either way.`,
      choices: [
        { value: 'occurrence', title: 'Delete only this occurrence', text: formatLongDate(occ.date) },
        {
          value: 'series',
          title: 'Delete the entire series',
          text: 'All remaining occurrences and their reminders are removed.',
        },
      ],
    })
    if (scope === 'occurrence') {
      const result = await this.dispatch({
        type: 'task/delete',
        taskId: task.id,
        scope: { kind: 'occurrence', key: occ.key },
      })
      if (result.ok) this.offerRestore(occ, 'Occurrence deleted')
    } else if (scope === 'series') {
      const ok = await confirmDialog({
        title: 'Delete the entire series?',
        message: `Every remaining occurrence of “${task.title}” will be removed. This can’t be undone.`,
        confirmLabel: 'Delete series',
        danger: true,
      })
      if (!ok) return
      const result = await this.dispatch({ type: 'task/delete', taskId: task.id, scope: { kind: 'series' } })
      if (result.ok) this.toast({ tone: 'success', title: 'Series deleted' })
    }
  }

  missedCount(taskId: string): number {
    const task = state.data.tasks.find((t) => t.id === taskId)
    return task ? overdueOccurrences(task, this.now()).length : 0
  }

  /** Opens the file picker for a sound slot and reports what was added. */
  async chooseSound(slot: SoundSlot, label: string): Promise<void> {
    let result: SoundImportResult
    try {
      result = await this.api.chooseSound(slot)
    } catch (error) {
      console.error('[actions] chooseSound failed', error)
      this.toast({ tone: 'error', title: 'Couldn’t add the sound', body: 'Please try again.' })
      return
    }
    if (result.cancelled) return
    if (result.added > 0) {
      this.toast({
        tone: 'success',
        title:
          slot.kind === 'music'
            ? `Added ${result.added} ${result.added === 1 ? 'track' : 'tracks'}`
            : `Sound for “${label}” updated`,
      })
    }
    if (result.errors.length > 0) {
      this.toast({
        tone: 'error',
        title: result.added > 0 ? 'Some files couldn’t be added' : 'That file couldn’t be added',
        body: result.errors.join(' '),
      })
    }
  }

  async removeSound(slot: SoundSlot, label: string, trackId?: string): Promise<void> {
    let result: DispatchResult
    try {
      result = await this.api.removeSound(slot, trackId)
    } catch {
      result = { ok: false, error: 'Please try again.' }
    }
    this.toast(
      result.ok
        ? { tone: 'success', title: `Removed “${label}”` }
        : { tone: 'error', title: 'Couldn’t remove the sound', body: result.error },
    )
  }

  async testNotification() {
    try {
      return await this.api.testNotification()
    } catch {
      return { ok: false as const, error: 'The notification request failed.' }
    }
  }

  getAppInfo() {
    return this.api.getAppInfo()
  }

  async openDataFolder() {
    try {
      await this.api.openDataFolder()
    } catch {
      this.toast({ tone: 'error', title: 'Couldn’t open the data folder' })
    }
  }

  async openTaskLink(taskId: string) {
    try {
      if (await this.api.openTaskLink(taskId)) return
    } catch (error) {
      console.error('[actions] open link failed', error)
    }
    this.toast({ tone: 'error', title: 'Couldn’t open the link' })
  }

  async chooseImportFolder() {
    try {
      const result = await this.api.chooseImportFolder()
      state.setImportStatus(result.status)
      if (!result.cancelled && !result.status.folderError)
        this.toast({
          tone: 'success',
          title: 'Folder saved',
          body: 'Task Tracker checks it every few minutes.',
        })
    } catch (error) {
      console.error('[actions] choose folder failed', error)
      this.toast({ tone: 'error', title: 'Couldn’t save the folder', body: 'Please try again.' })
    }
  }

  async clearImportFolder() {
    try {
      state.setImportStatus(await this.api.clearImportFolder())
      this.toast({
        tone: 'success',
        title: 'Folder removed',
        body: 'Tasks already added are kept. No more suggestions will be read.',
      })
    } catch (error) {
      console.error('[actions] clear folder failed', error)
      this.toast({ tone: 'error', title: 'Couldn’t remove the folder', body: 'Please try again.' })
    }
  }

  async checkImportsNow() {
    try {
      const { status, reports } = await this.api.checkImportsNow()
      state.setImportStatus(status)
      // Reports are announced by the importChecked event; only say so when there was nothing new.
      if (reports.length === 0 && !status.folderError)
        this.toast({ tone: 'info', title: 'No new suggestions', duration: 3000 })
    } catch (error) {
      console.error('[actions] check folder failed', error)
      this.toast({ tone: 'error', title: 'Couldn’t check the folder', body: 'Please try again.' })
    }
  }

  /** One toast summarizing what a check imported; quiet when files changed but nothing was added or updated. */
  announceImports(reports: ImportReport[], openSettings: () => void) {
    const failed = reports.filter((r) => r.error !== null)
    const created = reports.reduce((n, r) => n + r.created, 0)
    const updated = reports.reduce((n, r) => n + r.updated, 0)
    const needsLook = reports.some((r) => r.notes.length > 0)
    const view = [{ label: 'Details', onClick: openSettings }]
    if (failed.length > 0) {
      this.toast({
        tone: 'error',
        title:
          failed.length === 1
            ? 'A suggestions file couldn’t be read'
            : 'Some suggestions files couldn’t be read',
        body: failed[0].error ?? undefined,
        duration: 12_000,
        actions: view,
      })
    }
    if (created + updated === 0 && !needsLook) return
    const parts = [
      created > 0 && (created === 1 ? '1 task added' : `${created} tasks added`),
      updated > 0 && (updated === 1 ? '1 task updated' : `${updated} tasks updated`),
    ].filter(Boolean)
    const origins = [...new Set(reports.map((r) => r.origin).filter(Boolean))]
    this.toast({
      tone: created + updated > 0 ? 'success' : 'info',
      title: parts.length ? `Suggested tasks: ${parts.join(', ')}` : 'Suggested tasks checked',
      body:
        [origins.length ? `From ${origins.join(' and ')}.` : '', needsLook ? 'Some items need a look.' : '']
          .filter(Boolean)
          .join(' ') || undefined,
      duration: 10_000,
      actions: view,
    })
  }

  private offerRestore(occ: Occurrence, title: string) {
    this.toast({
      tone: 'success',
      title,
      body: `${occ.task.title} · ${formatLongDate(occ.date)}`,
      duration: 6000,
      actions: [
        {
          label: 'Undo',
          onClick: () => void this.dispatch({ type: 'occurrence/restore', taskId: occ.taskId, key: occ.key }),
        },
      ],
    })
  }
}
