import { formatDue, shortRecurrence } from '../../domain/format'
import { occurrenceId, statusOf, type Occurrence } from '../../domain/occurrences'
import { h, icon } from '../dom'
import { Bell, Check, Clock, Pencil, Repeat, SkipForward, Trash } from '../icons'
import { categoryChips, difficultyChip, statusBadge } from './parts'

export interface RowHandlers {
  onComplete: (occ: Occurrence, row: HTMLElement, check: HTMLButtonElement) => void
  onOpen: (occ: Occurrence) => void
  onEdit: (occ: Occurrence) => void
  onSkip: (occ: Occurrence) => void
  onDelete: (occ: Occurrence) => void
}

export interface RowContext {
  now: number
  weekStart: number
  categoryName: (id: string) => string | undefined
}

/**
 * One active occurrence in a list (FR-9): the title is the strongest element; due date, status,
 * recurrence, reminders, difficulty and categories are secondary.
 */
export function taskRow(occ: Occurrence, ctx: RowContext, handlers: RowHandlers): HTMLLIElement {
  const { task } = occ
  const id = occurrenceId(occ.taskId, occ.key)
  const status = statusOf(occ, ctx.now)
  const recurring = task.recurrence.kind !== 'once'
  const categories = task.categoryIds.map(ctx.categoryName).filter((n): n is string => n !== undefined)
  const due = formatDue(occ.date, occ.dueTime, ctx.now)
  const reminderCount = task.reminders.length

  const check = h(
    'button',
    {
      type: 'button',
      class: 'check',
      role: 'checkbox',
      'aria-checked': 'false',
      'aria-label': `Mark “${task.title}” complete`,
      dataset: { focusKey: `check:${id}` },
    },
    icon(Check, 14),
  )

  const row = h(
    'li',
    { class: 'task-row', dataset: { status, occurrence: id } },
    check,
    h(
      'button',
      {
        type: 'button',
        class: 'task-row__body',
        'aria-label': `${task.title}, ${status === 'overdue' ? 'overdue, ' : ''}due ${due}. Show details`,
        dataset: { focusKey: `open:${id}` },
        onClick: () => handlers.onOpen(occ),
      },
      h('span', { class: 'task-row__title' }, task.title),
      h(
        'span',
        { class: 'task-row__meta' },
        statusBadge(status),
        h('span', { class: 'meta-item' }, icon(Clock, 13), due),
        recurring &&
          h(
            'span',
            { class: 'meta-item' },
            icon(Repeat, 13),
            shortRecurrence(task.recurrence, ctx.weekStart),
          ),
        reminderCount > 0 &&
          h(
            'span',
            { class: 'meta-item', title: reminderCount === 1 ? '1 reminder' : `${reminderCount} reminders` },
            icon(Bell, 13),
            h('span', { class: 'visually-hidden' }, 'Reminders: '),
            String(reminderCount),
          ),
        h('span', { class: 'task-row__chips' }, difficultyChip(task.difficulty), categoryChips(categories)),
      ),
    ),
    h(
      'div',
      { class: 'task-row__actions' },
      recurring &&
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Skip this occurrence of “${task.title}”`,
            title: 'Skip this occurrence',
            dataset: { focusKey: `skip:${id}` },
            onClick: () => handlers.onSkip(occ),
          },
          icon(SkipForward, 16),
        ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Edit “${task.title}”`,
          title: 'Edit',
          dataset: { focusKey: `edit:${id}` },
          onClick: () => handlers.onEdit(occ),
        },
        icon(Pencil, 16),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn icon-btn--danger',
          'aria-label': `Delete “${task.title}”`,
          title: 'Delete',
          dataset: { focusKey: `delete:${id}` },
          onClick: () => handlers.onDelete(occ),
        },
        icon(Trash, 16),
      ),
    ),
  )

  check.addEventListener('click', () => handlers.onComplete(occ, row, check))
  return row
}
