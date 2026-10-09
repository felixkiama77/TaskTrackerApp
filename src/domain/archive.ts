import { compareDates, localDateOf, type LocalDate, type LocalTime } from './dates'
import { deadline, type Occurrence } from './occurrences'
import {
  ARCHIVE_RETENTION_MS,
  type ArchiveRecord,
  type Category,
  type CompletionClassification,
} from './types'

/**
 * Classifies a completion by calendar day (see docs/DECISIONS.md):
 * early = on a day before the due date; on time = on the due date at or before the due time
 * (end of day without a time); overdue = after that.
 */
export function classifyCompletion(
  dueDate: LocalDate,
  dueTime: LocalTime | null,
  completedAt: number,
): Exclude<CompletionClassification, 'unknown'> {
  if (compareDates(localDateOf(completedAt), dueDate) < 0) return 'early'
  return completedAt <= deadline(dueDate, dueTime) ? 'on-time' : 'overdue'
}

/** Snapshot of an occurrence at completion time (FR-19). */
export function createArchiveRecord(
  occ: Occurrence,
  completedAt: number,
  categories: Category[],
  id: string,
): ArchiveRecord {
  const { task } = occ
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const categoryIds = task.categoryIds.filter((cid) => names.has(cid))
  return {
    id,
    taskId: task.id,
    occurrenceKey: occ.key,
    title: task.title,
    difficulty: task.difficulty,
    categoryIds,
    categoryNames: categoryIds.map((cid) => names.get(cid) ?? ''),
    dueDate: occ.date,
    dueTime: occ.dueTime,
    recurrence: structuredClone(task.recurrence),
    end: structuredClone(task.end),
    occurrenceNumber: occ.index + 1,
    reminders: [...task.reminders],
    completedAt: new Date(completedAt).toISOString(),
    classification: classifyCompletion(occ.date, occ.dueTime, completedAt),
  }
}

/** Epoch ms after which an archive record is removed. */
export function archiveExpiresAt(record: ArchiveRecord): number {
  return Date.parse(record.completedAt) + ARCHIVE_RETENTION_MS
}

/**
 * Removes archive records whose 90-day retention has elapsed (FR-20). Only archive records are
 * affected, and running it repeatedly is safe.
 */
export function purgeExpiredArchive(archive: ArchiveRecord[], now: number): ArchiveRecord[] {
  return archive.filter((record) => now < archiveExpiresAt(record))
}
