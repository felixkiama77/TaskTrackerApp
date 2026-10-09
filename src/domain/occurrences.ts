import { compareDates, endOfDayEpoch, epochAt, localDateOf, type LocalDate, type LocalTime } from './dates'
import { scheduledDates } from './recurrence'
import type { TaskDefinition } from './types'

export type OccurrenceState = 'active' | 'completed' | 'skipped' | 'detached'

/** Calendar/list status of an active occurrence (FR-31). */
export type OccurrenceStatus = 'overdue' | 'today' | 'future'

/** One scheduled instance of a task. Identified by task id + its original scheduled date (`key`). */
export interface Occurrence {
  taskId: string
  key: LocalDate
  /** 0-based position in the series. */
  index: number
  date: LocalDate
  dueTime: LocalTime | null
  /** Deadline instant: the due time, or the last millisecond of the due date when there is no time. */
  dueAt: number
  state: OccurrenceState
  task: TaskDefinition
}

/** The deadline of a date with an optional time. Date-only occurrences are due at the end of the day (FR-28). */
export function deadline(date: LocalDate, dueTime: LocalTime | null): number {
  return dueTime === null ? endOfDayEpoch(date) : epochAt(date, dueTime)
}

export function occurrenceId(taskId: string, key: LocalDate): string {
  return `${taskId}@${key}`
}

function stateOf(task: TaskDefinition, key: LocalDate): OccurrenceState {
  if (task.completed[key] !== undefined) return 'completed'
  return task.exceptions[key] ?? 'active'
}

/** All scheduled occurrences of a task in order, up to `until` (inclusive) when given. */
export function* occurrencesOf(
  task: TaskDefinition,
  until?: LocalDate,
  from?: LocalDate,
): Generator<Occurrence> {
  for (const { date, index } of scheduledDates(task, until, from)) {
    yield {
      taskId: task.id,
      key: date,
      index,
      date,
      dueTime: task.dueTime,
      dueAt: deadline(date, task.dueTime),
      state: stateOf(task, date),
      task,
    }
  }
}

/** Occurrences (any state) whose date is within [from, to]. */
export function occurrencesBetween(task: TaskDefinition, from: LocalDate, to: LocalDate): Occurrence[] {
  const result: Occurrence[] = []
  for (const occ of occurrencesOf(task, to, from)) if (compareDates(occ.date, from) >= 0) result.push(occ)
  return result
}

export function findOccurrence(task: TaskDefinition, key: LocalDate): Occurrence | null {
  for (const occ of occurrencesOf(task, key)) if (occ.key === key) return occ
  return null
}

/** An incomplete occurrence is overdue once its deadline has passed. */
export function isOverdue(occ: Occurrence, now: number): boolean {
  return now > occ.dueAt
}

export function statusOf(occ: Occurrence, now: number): OccurrenceStatus {
  if (isOverdue(occ, now)) return 'overdue'
  return occ.date === localDateOf(now) ? 'today' : 'future'
}

/** Active occurrences whose deadline has passed, oldest first. */
export function overdueOccurrences(task: TaskDefinition, now: number): Occurrence[] {
  const result: Occurrence[] = []
  for (const occ of occurrencesOf(task, localDateOf(now))) {
    if (occ.state === 'active' && isOverdue(occ, now)) result.push(occ)
  }
  return result
}

/** The first active occurrence that is not overdue (today's or the next upcoming one), if any. */
export function nextOccurrence(task: TaskDefinition, now: number): Occurrence | null {
  for (const occ of occurrencesOf(task)) {
    if (occ.state === 'active' && !isOverdue(occ, now)) return occ
  }
  return null
}

/** Active occurrences dated within [from, to]. */
export function activeOccurrencesBetween(task: TaskDefinition, from: LocalDate, to: LocalDate): Occurrence[] {
  return occurrencesBetween(task, from, to).filter((occ) => occ.state === 'active')
}
