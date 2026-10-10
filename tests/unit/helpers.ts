import { epochAt, type LocalDate, type LocalTime } from '../../src/domain/dates'
import type { CommandContext } from '../../src/domain/commands'
import type { TaskInput } from '../../src/domain/schemas'
import { emptyAppData, type AppData, type TaskDefinition } from '../../src/domain/types'

/** Local epoch ms for a date and time, e.g. at('2026-10-08', '09:30'). */
export const at = (date: LocalDate, time: LocalTime = '12:00') => epochAt(date, time)

export function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: 'task-1',
    title: 'Water plants',
    priority: 'medium',
    notes: '',
    link: null,
    categoryIds: [],
    startDate: '2026-10-08',
    dueTime: null,
    recurrence: { kind: 'once' },
    end: { kind: 'never' },
    endBefore: null,
    reminders: [],
    completed: {},
    exceptions: {},
    source: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

export function makeInput(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    title: 'Submit assignment',
    priority: 'medium',
    notes: '',
    link: null,
    dueDate: '2026-10-08',
    dueTime: null,
    recurrence: { kind: 'once' },
    end: { kind: 'never' },
    categoryIds: [],
    reminders: [],
    ...overrides,
  }
}

export function dataWith(tasks: TaskDefinition[] = [], extra: Partial<AppData> = {}): AppData {
  return { ...emptyAppData(), tasks, ...extra }
}

/** Command context with a controllable clock and predictable ids (id-1, id-2, …). */
export function makeCtx(now: number): CommandContext & { advance: (ms: number) => void } {
  let counter = 0
  const ctx = {
    now,
    newId: () => `id-${++counter}`,
    advance(ms: number) {
      ctx.now += ms
    },
  }
  return ctx
}
