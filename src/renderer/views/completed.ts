import { localDateOf, localTimeOf } from '../../domain/dates'
import { formatDue, formatRelativeDate, formatTime, inSentence } from '../../domain/format'
import { filterByCategories } from '../../domain/views'
import type { ArchiveRecord } from '../../domain/types'
import type { Actions } from '../actions'
import { categoryChips, classificationBadge, emptyState, priorityChip } from '../components/parts'
import { h, icon, type Child } from '../dom'
import { Archive, CircleCheck, Clock } from '../icons'
import { state } from '../state'
import { openArchiveDetail } from './detail'
import { listToolbar } from './list'
import type { ViewContent } from './shell'

function completedHeading(dayLabel: string): string {
  return dayLabel === 'Today' || dayLabel === 'Yesterday'
    ? `Completed ${dayLabel.toLowerCase()}`
    : `Completed on ${dayLabel}`
}

function archiveRow(record: ArchiveRecord, now: number): HTMLLIElement {
  return h(
    'li',
    { class: 'archive-row' },
    icon(CircleCheck, 18),
    h(
      'button',
      {
        type: 'button',
        class: 'task-row__body',
        dataset: { focusKey: `archive:${record.id}` },
        onClick: () => openArchiveDetail(record),
      },
      h('span', { class: 'task-row__title' }, record.title),
      h(
        'span',
        { class: 'task-row__meta' },
        classificationBadge(record.classification),
        h(
          'span',
          { class: 'meta-item' },
          `Completed at ${formatTime(localTimeOf(Date.parse(record.completedAt)))}`,
        ),
        h(
          'span',
          { class: 'meta-item' },
          icon(Clock, 13),
          `Due ${inSentence(formatDue(record.dueDate, record.dueTime, now))}`,
        ),
        h(
          'span',
          { class: 'task-row__chips' },
          priorityChip(record.priority),
          categoryChips(record.categoryNames),
        ),
      ),
    ),
  )
}

/** Completed occurrences from the archive (FR-14 "Completed", FR-21), each its own entry. */
export function completedView(actions: Actions): ViewContent {
  const now = actions.now()
  const order = state.ui.archiveOrder
  const all = state.data.archive
  const records = filterByCategories(all, state.ui.categoryFilter).sort((a, b) =>
    order === 'newest'
      ? b.completedAt.localeCompare(a.completedAt)
      : a.completedAt.localeCompare(b.completedAt),
  )

  let body: Child
  if (all.length === 0) {
    body = emptyState({
      art: Archive,
      title: 'No completed tasks yet',
      text: 'Tasks you complete appear here with when they were done, and are kept for 90 days.',
    })
  } else if (records.length === 0) {
    body = emptyState({
      art: Archive,
      title: 'No completed tasks in these categories',
      text: 'Choose other categories or clear the filter.',
      action: h(
        'button',
        { type: 'button', class: 'btn', onClick: () => state.setUi({ categoryFilter: new Set() }) },
        'Clear filters',
      ),
    })
  } else {
    const groups = new Map<string, ArchiveRecord[]>()
    for (const record of records) {
      const label = formatRelativeDate(localDateOf(Date.parse(record.completedAt)), now)
      groups.set(label, [...(groups.get(label) ?? []), record])
    }
    body = [...groups].map(([label, items]) =>
      h(
        'section',
        { class: 'list-group', 'aria-label': `Completed ${label}` },
        h('h2', { class: 'list-group__heading' }, completedHeading(label)),
        h(
          'ul',
          { class: 'task-list' },
          items.map((r) => archiveRow(r, now)),
        ),
      ),
    )
  }

  return {
    title: 'Completed',
    summary: `${records.length} completed · each is kept for 90 days after completion`,
    toolbar:
      all.length > 0
        ? [
            h(
              'label',
              { class: 'toolbar__group' },
              h('span', { class: 'toolbar__label' }, 'Order'),
              h(
                'select',
                {
                  class: 'select select--sm',
                  dataset: { focusKey: 'archive-order' },
                  onChange: (e: Event) =>
                    state.setUi({
                      archiveOrder: (e.target as HTMLSelectElement).value as 'newest' | 'oldest',
                    }),
                },
                h('option', { value: 'newest', selected: order === 'newest' }, 'Recently completed first'),
                h('option', { value: 'oldest', selected: order === 'oldest' }, 'Oldest first'),
              ),
            ),
            listToolbar({ showSort: false }),
          ]
        : undefined,
    body,
  }
}
