import { addDays, localDateOf, startOfWeek, type Weekday } from './dates'
import { activeOccurrencesBetween, nextOccurrence, overdueOccurrences, type Occurrence } from './occurrences'
import { DIFFICULTY_ORDER, type TaskDefinition } from './types'

/** Task-list views (FR-14). "completed" is served from the archive, not from occurrences. */
export type ListView = 'all' | 'today' | 'next3' | 'week' | 'overdue'

export type SortKey = 'due' | 'difficulty'
export type SortDirection = 'asc' | 'desc'
export interface SortOrder {
  key: SortKey
  direction: SortDirection
}

export interface DateRange {
  from: string
  to: string
}

/** Calendar-date range a view covers; `null` for views that are not a date range. */
export function viewRange(view: ListView, now: number, weekStart: Weekday): DateRange | null {
  const today = localDateOf(now)
  switch (view) {
    case 'today':
      return { from: today, to: today }
    case 'next3':
      // Tomorrow through three days from today; today has its own view.
      return { from: addDays(today, 1), to: addDays(today, 3) }
    case 'week': {
      const from = startOfWeek(today, weekStart)
      return { from, to: addDays(from, 6) }
    }
    default:
      return null
  }
}

/**
 * Active occurrences shown in a view. Each occurrence appears at most once.
 *
 * - all: every overdue occurrence plus each task's next upcoming (or today's) occurrence.
 * - today / next3 / week: every active occurrence dated in the range, overdue or not.
 * - overdue: every overdue occurrence.
 */
export function occurrencesForView(
  tasks: TaskDefinition[],
  view: ListView,
  now: number,
  weekStart: Weekday,
): Occurrence[] {
  const range = viewRange(view, now, weekStart)
  const result: Occurrence[] = []
  for (const task of tasks) {
    if (range) {
      result.push(...activeOccurrencesBetween(task, range.from, range.to))
    } else {
      result.push(...overdueOccurrences(task, now))
      if (view === 'all') {
        const next = nextOccurrence(task, now)
        if (next) result.push(next)
      }
    }
  }
  return result
}

/** Keeps occurrences in at least one of the selected categories; an empty selection keeps everything (FR-13). */
export function filterByCategories<T extends { categoryIds: string[] }>(
  items: T[],
  selected: ReadonlySet<string>,
): T[] {
  if (selected.size === 0) return items
  return items.filter((item) => item.categoryIds.some((id) => selected.has(id)))
}

/** Category filter for occurrences, using the live task's categories. */
export function filterOccurrencesByCategories(
  occurrences: Occurrence[],
  selected: ReadonlySet<string>,
): Occurrence[] {
  if (selected.size === 0) return occurrences
  return occurrences.filter((occ) => occ.task.categoryIds.some((id) => selected.has(id)))
}

function compareDue(a: Occurrence, b: Occurrence): number {
  return a.dueAt - b.dueAt || a.task.title.localeCompare(b.task.title) || a.key.localeCompare(b.key)
}

/**
 * Sorts occurrences (FR-11, FR-12). By due date, date-only occurrences sort after timed ones on the
 * same day because they are due at the end of it. Difficulty ascending is Easy → Hard; ties are
 * ordered by due date.
 */
export function sortOccurrences(occurrences: Occurrence[], order: SortOrder): Occurrence[] {
  const sign = order.direction === 'asc' ? 1 : -1
  const copy = [...occurrences]
  if (order.key === 'due') {
    copy.sort((a, b) => sign * compareDue(a, b))
  } else {
    copy.sort(
      (a, b) =>
        sign * (DIFFICULTY_ORDER[a.task.difficulty] - DIFFICULTY_ORDER[b.task.difficulty]) ||
        compareDue(a, b),
    )
  }
  return copy
}

export function viewCounts(
  tasks: TaskDefinition[],
  now: number,
  weekStart: Weekday,
): Record<ListView, number> {
  const views: ListView[] = ['all', 'today', 'next3', 'week', 'overdue']
  return Object.fromEntries(
    views.map((view) => [view, occurrencesForView(tasks, view, now, weekStart).length]),
  ) as Record<ListView, number>
}
