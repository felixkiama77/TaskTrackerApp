import { createArchiveRecord, purgeExpiredArchive } from './archive'
import { compareDates, dateParts, monthDateClamped, type LocalDate } from './dates'
import { findOccurrence, overdueOccurrences } from './occurrences'
import type { Command, DeleteScope, TaskInput, UpdateScope } from './schemas'
import {
  MAX_CATEGORIES,
  MAX_TASKS,
  type AppData,
  type Recurrence,
  type RecurrenceEnd,
  type TaskDefinition,
} from './types'

export interface CommandContext {
  now: number
  newId: () => string
}

export interface CommandResult {
  data: AppData
  /** Whether anything changed (repeating an idempotent command does not). */
  changed: boolean
  /** Short confirmation for the user (FR-37). */
  message: string
}

/** A command that cannot be applied; the message is shown to the user. */
export class CommandError extends Error {
  override name = 'CommandError'
}

/** Notification bookkeeping older than this is pruned. */
const DELIVERED_RETENTION_MS = 35 * 86_400_000

export function applyCommand(data: AppData, command: Command, ctx: CommandContext): CommandResult {
  const next = structuredClone(data)
  const result = (message: string, changed = true): CommandResult => ({
    data: changed ? next : data,
    changed,
    message,
  })

  switch (command.type) {
    case 'task/create': {
      assertRoomForTask(next)
      next.tasks.push(taskFromInput(command.input, next, ctx.newId(), ctx.now))
      return result('Task created.')
    }
    case 'task/update':
      return result(updateTask(next, command.taskId, command.input, command.scope, ctx))
    case 'task/delete':
      return result(deleteTask(next, command.taskId, command.scope))
    case 'task/skipMissed': {
      const task = requireTask(next, command.taskId)
      const missed = overdueOccurrences(task, ctx.now)
      for (const occ of missed) task.exceptions[occ.key] = 'skipped'
      if (missed.length === 0) return result('No missed occurrences to skip.', false)
      touch(task, ctx.now)
      return result(
        missed.length === 1 ? 'Skipped 1 missed occurrence.' : `Skipped ${missed.length} missed occurrences.`,
      )
    }
    case 'occurrence/complete': {
      const task = requireTask(next, command.taskId)
      if (task.completed[command.key] !== undefined) return result('Already completed.', false)
      const occ = requireActiveOccurrence(task, command.key)
      const completedAt = new Date(ctx.now).toISOString()
      task.completed[occ.key] = completedAt
      next.archive.push(createArchiveRecord(occ, ctx.now, next.categories, ctx.newId()))
      touch(task, ctx.now)
      return result('Task completed.')
    }
    case 'occurrence/uncomplete': {
      const task = requireTask(next, command.taskId)
      if (task.completed[command.key] === undefined) return result('Not completed.', false)
      delete task.completed[command.key]
      next.archive = next.archive.filter((r) => !(r.taskId === task.id && r.occurrenceKey === command.key))
      touch(task, ctx.now)
      return result('Completion undone.')
    }
    case 'occurrence/skip': {
      const task = requireTask(next, command.taskId)
      requireActiveOccurrence(task, command.key)
      task.exceptions[command.key] = 'skipped'
      touch(task, ctx.now)
      return result('Occurrence skipped.')
    }
    case 'occurrence/restore': {
      // Undo for a skipped (or individually deleted) occurrence.
      const task = requireTask(next, command.taskId)
      if (task.exceptions[command.key] !== 'skipped') return result('Nothing to restore.', false)
      delete task.exceptions[command.key]
      touch(task, ctx.now)
      return result('Occurrence restored.')
    }
    case 'category/create': {
      const name = command.name.trim()
      if (next.categories.length >= MAX_CATEGORIES) {
        throw new CommandError(`You can have up to ${MAX_CATEGORIES} categories. Delete one to add another.`)
      }
      assertUniqueCategoryName(next, name, null)
      next.categories.push({ id: ctx.newId(), name, createdAt: new Date(ctx.now).toISOString() })
      return result(`Category “${name}” created.`)
    }
    case 'category/rename': {
      const category = next.categories.find((c) => c.id === command.categoryId)
      if (!category) throw new CommandError('This category no longer exists.')
      const name = command.name.trim()
      if (name === category.name) return result('No changes.', false)
      assertUniqueCategoryName(next, name, category.id)
      category.name = name
      return result(`Category renamed to “${name}”.`)
    }
    case 'category/delete': {
      const category = next.categories.find((c) => c.id === command.categoryId)
      if (!category) throw new CommandError('This category no longer exists.')
      next.categories = next.categories.filter((c) => c.id !== category.id)
      // Remove only the association; tasks and archive records stay (FR-7). Archive records keep the
      // category name they were completed with.
      for (const task of next.tasks) {
        if (task.categoryIds.includes(category.id)) {
          task.categoryIds = task.categoryIds.filter((id) => id !== category.id)
          touch(task, ctx.now)
        }
      }
      for (const record of next.archive)
        record.categoryIds = record.categoryIds.filter((id) => id !== category.id)
      return result(`Category “${category.name}” deleted. Its tasks were kept.`)
    }
    case 'settings/update': {
      Object.assign(next.settings, command.patch)
      return result('Settings saved.')
    }
  }
}

/**
 * Periodic upkeep, safe to run any number of times: removes expired archive records (FR-20) and old
 * notification bookkeeping. Active tasks are never touched.
 */
export function runMaintenance(data: AppData, now: number): { data: AppData; changed: boolean } {
  const archive = purgeExpiredArchive(data.archive, now)
  const delivered = Object.fromEntries(
    Object.entries(data.alerts.delivered).filter(([, at]) => now - at < DELIVERED_RETENTION_MS),
  )
  const changed =
    archive.length !== data.archive.length ||
    Object.keys(delivered).length !== Object.keys(data.alerts.delivered).length
  if (!changed) return { data, changed }
  return { data: { ...data, archive, alerts: { ...data.alerts, delivered } }, changed }
}

function requireTask(data: AppData, taskId: string): TaskDefinition {
  const task = data.tasks.find((t) => t.id === taskId)
  if (!task) throw new CommandError('This task no longer exists.')
  return task
}

function requireActiveOccurrence(task: TaskDefinition, key: LocalDate) {
  const occ = findOccurrence(task, key)
  if (!occ) throw new CommandError('This occurrence is not part of the task’s schedule.')
  if (occ.state !== 'active') throw new CommandError('This occurrence is no longer active.')
  return occ
}

function assertRoomForTask(data: AppData) {
  if (data.tasks.length >= MAX_TASKS) {
    throw new CommandError(
      `You can have up to ${MAX_TASKS.toLocaleString('en-US')} tasks. Delete some to add more.`,
    )
  }
}

function touch(task: TaskDefinition, now: number) {
  task.updatedAt = new Date(now).toISOString()
}

function assertUniqueCategoryName(data: AppData, name: string, exceptId: string | null) {
  const key = name.toLocaleLowerCase()
  if (data.categories.some((c) => c.id !== exceptId && c.name.trim().toLocaleLowerCase() === key)) {
    throw new CommandError(`A category named “${name}” already exists.`)
  }
}

/**
 * A monthly anchor must produce the start date in the start month (e.g. anchor 31 → Feb 28). When it
 * does not, the anchor is the start date's own day.
 */
function normalizeRecurrence(recurrence: Recurrence, startDate: LocalDate): Recurrence {
  if (recurrence.kind === 'weekly')
    return { kind: 'weekly', weekdays: [...new Set(recurrence.weekdays)].sort() }
  if (recurrence.kind !== 'monthly') return recurrence
  const { year, month, day } = dateParts(startDate)
  const anchored = monthDateClamped(year, month, 0, recurrence.dayOfMonth) === startDate
  return { kind: 'monthly', dayOfMonth: anchored ? recurrence.dayOfMonth : day }
}

function taskFromInput(input: TaskInput, data: AppData, id: string, now: number): TaskDefinition {
  const iso = new Date(now).toISOString()
  const known = new Set(data.categories.map((c) => c.id))
  const recurrence = normalizeRecurrence(input.recurrence, input.dueDate)
  const end: RecurrenceEnd = recurrence.kind === 'once' ? { kind: 'never' } : input.end
  return {
    id,
    title: input.title.trim(),
    priority: input.priority,
    notes: input.notes.trim(),
    link: input.link === null || input.link.trim() === '' ? null : input.link.trim(),
    // A category deleted while the editor was open is simply dropped.
    categoryIds: input.categoryIds.filter((cid) => known.has(cid)),
    startDate: input.dueDate,
    dueTime: input.dueTime,
    recurrence,
    end,
    endBefore: null,
    reminders: [...input.reminders].sort((a, b) => a - b),
    completed: {},
    exceptions: {},
    source: null,
    createdAt: iso,
    updatedAt: iso,
  }
}

function updateTask(
  data: AppData,
  taskId: string,
  input: TaskInput,
  scope: UpdateScope,
  ctx: CommandContext,
): string {
  const task = requireTask(data, taskId)
  const isRecurring = task.recurrence.kind !== 'once'

  if (scope.kind === 'series' || !isRecurring) {
    if (isRecurring)
      throw new CommandError('Choose whether to change only this occurrence or this and future ones.')
    replaceDefinition(task, taskFromInput(input, data, task.id, ctx.now))
    return 'Task updated.'
  }

  const occ = requireActiveOccurrence(task, scope.key)

  if (scope.kind === 'occurrence') {
    // "Only this occurrence": the occurrence leaves the series and becomes its own one-time task.
    assertRoomForTask(data)
    task.exceptions[occ.key] = 'detached'
    touch(task, ctx.now)
    data.tasks.push(taskFromInput({ ...input, recurrence: { kind: 'once' } }, data, ctx.newId(), ctx.now))
    return 'This occurrence was updated.'
  }

  // "This and future": earlier occurrences keep the old rule; this one onward follows the new one.
  if (occ.index === 0) {
    const updated = taskFromInput(input, data, task.id, ctx.now)
    replaceDefinition(task, { ...updated, endBefore: task.endBefore })
    return 'Task updated.'
  }

  assertRoomForTask(data)
  const successor = taskFromInput(input, data, ctx.newId(), ctx.now)
  // The repeat count describes the whole series, so the new part gets what remains of it.
  if (successor.end.kind === 'count') {
    successor.end = { kind: 'count', count: Math.max(1, successor.end.count - occ.index) }
  }
  successor.endBefore = task.endBefore
  // Completions or skips already recorded for dates from here on move with them.
  for (const field of ['completed', 'exceptions'] as const) {
    for (const key of Object.keys(task[field])) {
      if (compareDates(key, occ.key) >= 0) {
        ;(successor[field] as Record<string, unknown>)[key] = task[field][key]
        delete task[field][key]
      }
    }
  }
  task.endBefore = occ.key
  touch(task, ctx.now)
  data.tasks.push(successor)
  return 'This and future occurrences were updated.'
}

/** Applies new definition fields while keeping identity, per-occurrence history and where it came from. */
function replaceDefinition(task: TaskDefinition, updated: TaskDefinition) {
  const { completed, exceptions, createdAt, id, source } = task
  Object.assign(task, updated, { id, completed, exceptions, createdAt, source })
}

function deleteTask(data: AppData, taskId: string, scope: DeleteScope): string {
  const task = requireTask(data, taskId)
  if (scope.kind === 'occurrence' && task.recurrence.kind !== 'once') {
    requireActiveOccurrence(task, scope.key)
    task.exceptions[scope.key] = 'skipped'
    return 'Occurrence deleted.'
  }
  // Removing the definition also drops its pending reminders; archive records are kept.
  data.tasks = data.tasks.filter((t) => t.id !== task.id)
  return task.recurrence.kind === 'once' ? 'Task deleted.' : 'Task and all remaining occurrences deleted.'
}
