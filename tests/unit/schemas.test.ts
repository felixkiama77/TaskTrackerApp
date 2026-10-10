import { describe, expect, it } from 'vitest'
import { CommandSchema, fieldErrors, TaskInputSchema } from '../../src/domain/schemas'
import { describeReminder } from '../../src/domain/format'
import { makeInput } from './helpers'

const errorsFor = (input: unknown) => {
  const result = TaskInputSchema.safeParse(input)
  return result.success ? {} : fieldErrors(result.error)
}

describe('task input validation (FR-1, FR-36)', () => {
  it('accepts a complete task', () => {
    expect(TaskInputSchema.safeParse(makeInput()).success).toBe(true)
  })

  it('explains each invalid field', () => {
    expect(errorsFor(makeInput({ title: '   ' }))).toEqual({ title: 'Enter a task name.' })
    expect(errorsFor(makeInput({ dueDate: '' }))).toEqual({ dueDate: 'Choose a due date.' })
    expect(errorsFor(makeInput({ dueDate: '2026-02-30' }))).toEqual({ dueDate: 'Enter a valid date.' })
    expect(errorsFor(makeInput({ dueTime: '25:00' }))).toEqual({ dueTime: 'Enter a valid time.' })
    expect(errorsFor(makeInput({ recurrence: { kind: 'weekly', weekdays: [] } }))).toEqual({
      'recurrence.weekdays': 'Choose at least one day.',
    })
    expect(errorsFor(makeInput({ recurrence: { kind: 'daily' }, end: { kind: 'count', count: 0 } }))).toEqual(
      {
        'end.count': 'A task occurs at least once.',
      },
    )
    expect(errorsFor({ ...makeInput(), priority: undefined })).toEqual({
      priority: 'Choose a priority.',
    })
  })

  it('rejects duplicate categories and unsupported reminder times', () => {
    expect(errorsFor(makeInput({ categoryIds: ['a', 'a'] }))).toEqual({
      categoryIds: 'A category can only be assigned once.',
    })
    expect(Object.keys(errorsFor(makeInput({ reminders: [7] })))).toEqual(['reminders.0'])
  })
})

describe('IPC command validation (FR-26)', () => {
  it('rejects unknown commands and malformed payloads', () => {
    expect(CommandSchema.safeParse({ type: 'fs/readFile', path: 'C:/' }).success).toBe(false)
    expect(CommandSchema.safeParse({ type: 'occurrence/complete', taskId: 't' }).success).toBe(false)
    expect(CommandSchema.safeParse({ type: 'settings/update', patch: { evil: true } }).success).toBe(false)
    expect(
      CommandSchema.safeParse({ type: 'occurrence/complete', taskId: 't', key: '2026-10-08' }).success,
    ).toBe(true)
  })
})

describe('notes, links and the new reminder times', () => {
  it('accepts an https link and empty notes, and fills them in when left out', () => {
    const parsed = TaskInputSchema.parse({ ...makeInput(), notes: undefined, link: undefined })
    expect(parsed).toMatchObject({ notes: '', link: null })
    expect(
      TaskInputSchema.safeParse({ ...makeInput(), link: 'https://canvas.uw.edu/courses/1' }).success,
    ).toBe(true)
  })

  it('rejects links that are not https, or that carry a username or password', () => {
    for (const link of [
      'http://example.com',
      'javascript:alert(1)',
      'file:///C:/x',
      'example.com',
      'https://a:b@example.com',
    ]) {
      expect(errorsFor({ ...makeInput(), link })).toEqual({
        link: 'Enter a full link starting with https://',
      })
    }
  })

  it('limits notes to 1,000 characters', () => {
    expect(errorsFor({ ...makeInput(), notes: 'x'.repeat(1001) })).toEqual({
      notes: 'Keep notes under 1,000 characters.',
    })
  })

  it('offers reminders 6 and 12 hours before', () => {
    expect(
      TaskInputSchema.safeParse({ ...makeInput(), dueTime: '23:59', reminders: [360, 720] }).success,
    ).toBe(true)
    expect(describeReminder(360, true)).toBe('6 hours before')
    expect(describeReminder(720, true)).toBe('12 hours before')
  })
})
