import { describe, expect, it } from 'vitest'
import { classifyCompletion, createArchiveRecord, purgeExpiredArchive } from '../../src/domain/archive'
import { findOccurrence } from '../../src/domain/occurrences'
import { ARCHIVE_RETENTION_MS, type ArchiveRecord } from '../../src/domain/types'
import { at, makeTask } from './helpers'

describe('completion classification (FR-18)', () => {
  it('timed tasks: earlier day = early, same day up to the due time = on time, after = overdue', () => {
    expect(classifyCompletion('2026-10-08', '17:00', at('2026-10-07', '23:00'))).toBe('early')
    expect(classifyCompletion('2026-10-08', '17:00', at('2026-10-08', '06:00'))).toBe('on-time')
    expect(classifyCompletion('2026-10-08', '17:00', at('2026-10-08', '17:00'))).toBe('on-time')
    expect(classifyCompletion('2026-10-08', '17:00', at('2026-10-08', '17:01'))).toBe('overdue')
    expect(classifyCompletion('2026-10-08', '17:00', at('2026-10-09', '08:00'))).toBe('overdue')
  })

  it('date-only tasks: any time on the due date is on time', () => {
    expect(classifyCompletion('2026-10-08', null, at('2026-10-07', '12:00'))).toBe('early')
    expect(classifyCompletion('2026-10-08', null, at('2026-10-08', '23:59'))).toBe('on-time')
    expect(classifyCompletion('2026-10-08', null, at('2026-10-09', '00:00'))).toBe('overdue')
  })
})

describe('archive snapshot (FR-19)', () => {
  it('captures the original details, category names and occurrence position', () => {
    const task = makeTask({
      title: 'Gym',
      difficulty: 'hard',
      startDate: '2026-10-05',
      dueTime: '18:00',
      recurrence: { kind: 'weekly', weekdays: [1, 4] },
      end: { kind: 'count', count: 10 },
      categoryIds: ['health', 'gone'],
      reminders: [15],
    })
    const occ = findOccurrence(task, '2026-10-08')!
    const record = createArchiveRecord(
      occ,
      at('2026-10-08', '17:45'),
      [{ id: 'health', name: 'Health', createdAt: '2026-01-01T00:00:00.000Z' }],
      'rec-1',
    )
    expect(record).toMatchObject({
      id: 'rec-1',
      taskId: task.id,
      occurrenceKey: '2026-10-08',
      title: 'Gym',
      difficulty: 'hard',
      categoryIds: ['health'],
      categoryNames: ['Health'],
      dueDate: '2026-10-08',
      dueTime: '18:00',
      recurrence: { kind: 'weekly', weekdays: [1, 4] },
      end: { kind: 'count', count: 10 },
      occurrenceNumber: 2,
      reminders: [15],
      classification: 'on-time',
    })
    expect(Date.parse(record.completedAt)).toBe(at('2026-10-08', '17:45'))
  })

  it('is a copy: later edits to the task do not change it', () => {
    const task = makeTask({ recurrence: { kind: 'weekly', weekdays: [4] } })
    const record = createArchiveRecord(findOccurrence(task, '2026-10-08')!, at('2026-10-08'), [], 'r')
    task.title = 'Renamed'
    ;(task.recurrence as { weekdays: number[] }).weekdays.push(5)
    expect(record.title).toBe('Water plants')
    expect(record.recurrence).toEqual({ kind: 'weekly', weekdays: [4] })
  })
})

describe('90-day retention (FR-20)', () => {
  const record = (completedAt: string): ArchiveRecord =>
    ({ id: completedAt, completedAt }) as unknown as ArchiveRecord
  const completedAt = '2026-07-01T15:00:00.000Z'
  const expiry = Date.parse(completedAt) + ARCHIVE_RETENTION_MS

  it('keeps records until 90 days after completion, then removes them', () => {
    expect(purgeExpiredArchive([record(completedAt)], expiry - 1)).toHaveLength(1)
    expect(purgeExpiredArchive([record(completedAt)], expiry)).toHaveLength(0)
  })

  it('is idempotent and leaves younger records alone', () => {
    const archive = [record(completedAt), record('2026-09-01T00:00:00.000Z')]
    const once = purgeExpiredArchive(archive, expiry)
    expect(purgeExpiredArchive(once, expiry)).toEqual(once)
    expect(once.map((r) => r.completedAt)).toEqual(['2026-09-01T00:00:00.000Z'])
  })
})
