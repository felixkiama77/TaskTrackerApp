import { formatLongDate } from '../domain/format'
import { overdueOccurrences, type Occurrence } from '../domain/occurrences'
import type { Command } from '../domain/schemas'
import type { DispatchResult, TaskTrackerApi } from '../shared/api'
import { clock } from './clock'
import { chooseDialog, confirmDialog } from './components/dialog'
import type { ToastOptions, Toaster } from './components/toast'
import { motionDelay } from './dom'
import { state } from './state'
import { openOccurrenceDetail } from './views/detail'
import { openTaskEditor } from './views/editor'

/**
 * Every user action goes through here: it sends a validated command to the main process and gives
 * clear feedback (FR-37). Errors are always shown as text; animations are only a bonus.
 */
export class Actions {
  constructor(
    private readonly api: TaskTrackerApi,
    private readonly toaster: Toaster,
  ) {}

  now = () => clock.now()

  toast(options: ToastOptions) {
    return this.toaster.show(options)
  }

  async dispatch(command: Command, options: { quiet?: boolean } = {}): Promise<DispatchResult> {
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
