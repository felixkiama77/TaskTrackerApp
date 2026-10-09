import { archiveExpiresAt } from '../../domain/archive'
import { localDateOf } from '../../domain/dates'
import {
  describeRecurrence,
  describeReminder,
  formatDue,
  formatLongDate,
  formatTime,
  formatTimestamp,
} from '../../domain/format'
import { findOccurrence, statusOf, type Occurrence } from '../../domain/occurrences'
import { DIFFICULTY_LABEL, type ArchiveRecord } from '../../domain/types'
import type { Actions } from '../actions'
import { openDialog } from '../components/dialog'
import { categoryChips, classificationBadge, statusBadge } from '../components/parts'
import { h, icon, type Child } from '../dom'
import { Check, Pencil, SkipForward, Trash, TriangleAlert } from '../icons'
import { state } from '../state'

const row = (label: string, value: Child) => [h('dt', null, label), h('dd', null, value)]

/** Details and actions for one active occurrence (opened from a list row, the calendar or a notification). */
export function openOccurrenceDetail(occ: Occurrence, actions: Actions) {
  const { task } = occ
  const now = actions.now()
  const status = statusOf(occ, now)
  const recurring = task.recurrence.kind !== 'once'
  const categories = task.categoryIds.map((id) => state.categoryName(id)).filter((n): n is string => !!n)
  const missed = recurring ? actions.missedCount(task.id) : 0
  const hasTime = task.dueTime !== null
  const run = (fn: () => void) => () => {
    handle.close()
    fn()
  }

  const handle = openDialog({
    title: task.title,
    subtitle: recurring
      ? `Occurrence ${occ.index + 1}${task.end.kind === 'count' ? ` of ${task.end.count}` : ''}`
      : undefined,
    body: [
      missed > 1 &&
        h(
          'div',
          { class: 'banner banner--danger' },
          icon(TriangleAlert, 18),
          h('span', { class: 'banner__text' }, `${missed} occurrences of this task were missed.`),
          h(
            'button',
            { type: 'button', class: 'btn btn--sm', onClick: run(() => void actions.skipAllMissed(task.id)) },
            'Skip all missed',
          ),
        ),
      h(
        'dl',
        { class: 'detail-list' },
        row('Due', [formatLongDate(occ.date), hasTime ? ` at ${formatTime(occ.dueTime!)}` : ' (end of day)']),
        row(
          'Status',
          statusBadge(status) ?? h('span', { class: 'status-badge status-badge--future' }, 'Upcoming'),
        ),
        row('Repeats', describeRecurrence(task.recurrence, task.end, state.weekStart())),
        row('Difficulty', DIFFICULTY_LABEL[task.difficulty]),
        row(
          'Categories',
          categories.length ? h('span', { class: 'task-row__chips' }, categoryChips(categories)) : 'None',
        ),
        row(
          'Reminders',
          task.reminders.length
            ? task.reminders.map((lead) => describeReminder(lead, hasTime)).join(', ')
            : 'None',
        ),
      ),
    ],
    footer: [
      h(
        'button',
        { type: 'button', class: 'btn btn--danger', onClick: run(() => void actions.deleteOccurrence(occ)) },
        icon(Trash, 16),
        'Delete',
      ),
      h('span', { class: 'dialog__footer-spacer' }),
      recurring &&
        h(
          'button',
          { type: 'button', class: 'btn', onClick: run(() => void actions.skipOccurrence(occ)) },
          icon(SkipForward, 16),
          'Skip',
        ),
      h(
        'button',
        { type: 'button', class: 'btn', onClick: run(() => actions.editOccurrence(occ)) },
        icon(Pencil, 16),
        'Edit',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          onClick: run(() => void actions.completeOccurrence(occ)),
        },
        icon(Check, 16),
        'Mark complete',
      ),
    ],
  })
}

/** Read-only historical record of a completed occurrence (FR-19, FR-21). */
export function openArchiveDetail(record: ArchiveRecord) {
  const hasTime = record.dueTime !== null
  const expires = localDateOf(archiveExpiresAt(record))
  const handle = openDialog({
    title: record.title,
    subtitle: 'Completed',
    body: h(
      'dl',
      { class: 'detail-list' },
      row('Completed', formatTimestamp(record.completedAt)),
      row('Timing', classificationBadge(record.classification)),
      row('Was due', [
        formatLongDate(record.dueDate),
        hasTime ? ` at ${formatTime(record.dueTime!)}` : ' (end of day)',
      ]),
      record.recurrence.kind !== 'once' &&
        row(
          'Repeats',
          `${describeRecurrence(record.recurrence, record.end, state.weekStart())} · occurrence ${record.occurrenceNumber}`,
        ),
      row('Difficulty', DIFFICULTY_LABEL[record.difficulty]),
      row(
        'Categories',
        record.categoryNames.length
          ? h('span', { class: 'task-row__chips' }, categoryChips(record.categoryNames))
          : 'None',
      ),
      row('Kept until', `${formatLongDate(expires)} (90 days after completion)`),
    ),
    footer: [
      h('span', { class: 'dialog__footer-spacer' }),
      h('button', { type: 'button', class: 'btn', onClick: () => handle.close() }, 'Close'),
    ],
  })
}

/** Opens the occurrence a notification refers to, if it is still active. */
export function openFromNotification(taskId: string, key: string, actions: Actions) {
  const task = state.data.tasks.find((t) => t.id === taskId)
  const occ = task ? findOccurrence(task, key) : null
  if (occ && occ.state === 'active') return actions.openDetail(occ)
  actions.toast({
    tone: 'info',
    title: 'That task is no longer active',
    body: 'It may have been completed or deleted.',
  })
}

/** All items on one calendar day, when they don't fit in the month grid. */
export function openDayDialog(date: string, items: Child, now: number) {
  openDialog({
    title: formatLongDate(date),
    subtitle: formatDue(date, null, now) === 'Today' ? 'Today' : undefined,
    size: 'sm',
    body: h('div', { class: 'agenda-list' }, items),
  })
}
