import { isValidLocalDate, localDateOf, localTimeOf, type LocalDate, type LocalTime } from './dates'
import {
  MAX_CATEGORIES,
  MAX_TASKS,
  type AppData,
  type ArchiveRecord,
  type Priority,
  type TaskDefinition,
} from './types'

/**
 * One-time import of data saved by the earlier version of the app in renderer localStorage under the
 * keys "Tasks" and "Tags". Nothing is discarded: unreadable dates are replaced with the import date
 * and reported, and tasks that were already complete go straight to the archive. The legacy keys
 * themselves are never modified.
 */
export interface LegacyRaw {
  tasks: string | null
  tags: string | null
}

export interface LegacyImportReport {
  alreadyImported: boolean
  tasks: number
  completed: number
  categories: number
  /** Tasks whose due date was missing or unreadable and was set to the import date. */
  repairedDates: number
  /** Entries that were not objects at all and could not be imported. */
  unreadable: number
}

interface LegacyTask {
  title?: unknown
  dueDate?: unknown
  includesTime?: unknown
  state?: unknown
  tags?: unknown
  priority?: unknown
}

const LEGACY_PRIORITY: Record<string, Priority> = { low: 'low', normal: 'medium', high: 'high' }

function parseArray(json: string | null): unknown[] {
  if (!json) return []
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function legacyDue(task: LegacyTask): { date: LocalDate; time: LocalTime | null } | null {
  if (typeof task.dueDate !== 'string') return null
  // The first web version stored <input type="date"> values as-is.
  if (isValidLocalDate(task.dueDate)) return { date: task.dueDate, time: null }
  // The flatpickr version stored a full ISO instant.
  const ms = Date.parse(task.dueDate)
  if (Number.isNaN(ms)) return null
  return { date: localDateOf(ms), time: task.includesTime === true ? localTimeOf(ms) : null }
}

export function importLegacyData(
  data: AppData,
  raw: LegacyRaw,
  ctx: { now: number; newId: () => string },
): { data: AppData; report: LegacyImportReport } {
  const report: LegacyImportReport = {
    alreadyImported: data.meta.legacyImportedAt !== null,
    tasks: 0,
    completed: 0,
    categories: 0,
    repairedDates: 0,
    unreadable: 0,
  }
  if (report.alreadyImported) return { data, report }

  const next = structuredClone(data)
  const nowIso = new Date(ctx.now).toISOString()
  const categoryIdByName = new Map(next.categories.map((c) => [c.name.trim().toLocaleLowerCase(), c.id]))

  const categoryIdFor = (rawName: unknown): string | null => {
    if (typeof rawName !== 'string') return null
    const name = rawName.trim().slice(0, 40)
    if (!name) return null
    const key = name.toLocaleLowerCase()
    let id = categoryIdByName.get(key)
    if (!id) {
      id = ctx.newId()
      categoryIdByName.set(key, id)
      next.categories.push({ id, name, createdAt: nowIso })
      report.categories++
    }
    return id
  }

  for (const tag of parseArray(raw.tags).slice(0, MAX_CATEGORIES)) {
    if (tag && typeof tag === 'object') categoryIdFor((tag as { tagName?: unknown }).tagName)
  }

  for (const entry of parseArray(raw.tasks).slice(0, MAX_TASKS)) {
    if (!entry || typeof entry !== 'object') {
      report.unreadable++
      continue
    }
    const legacy = entry as LegacyTask
    const title =
      (typeof legacy.title === 'string' ? legacy.title.trim() : '').slice(0, 200) || 'Untitled task'
    const priority = typeof legacy.priority === 'string' ? legacy.priority.toLowerCase() : ''
    let due = legacyDue(legacy)
    if (!due) {
      due = { date: localDateOf(ctx.now), time: null }
      report.repairedDates++
    }
    const categoryIds = [
      ...new Set(
        (Array.isArray(legacy.tags) ? legacy.tags : []).map(categoryIdFor).filter((id) => id !== null),
      ),
    ]
    const task: TaskDefinition = {
      id: ctx.newId(),
      title,
      priority: LEGACY_PRIORITY[priority] ?? 'medium',
      notes: '',
      link: null,
      categoryIds,
      startDate: due.date,
      dueTime: due.time,
      recurrence: { kind: 'once' },
      end: { kind: 'never' },
      endBefore: null,
      reminders: [],
      completed: {},
      exceptions: {},
      source: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    if (legacy.state === true) {
      // The old app never recorded when a task was completed, so the timing is "unknown".
      task.completed[due.date] = nowIso
      const record: ArchiveRecord = {
        id: ctx.newId(),
        taskId: task.id,
        occurrenceKey: due.date,
        title,
        priority: task.priority,
        categoryIds,
        categoryNames: categoryIds.map((id) => next.categories.find((c) => c.id === id)?.name ?? ''),
        dueDate: due.date,
        dueTime: due.time,
        recurrence: { kind: 'once' },
        end: { kind: 'never' },
        occurrenceNumber: 1,
        reminders: [],
        completedAt: nowIso,
        classification: 'unknown',
      }
      next.archive.push(record)
      report.completed++
    }
    next.tasks.push(task)
    report.tasks++
  }

  next.meta.legacyImportedAt = nowIso
  return { data: next, report }
}
