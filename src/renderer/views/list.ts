import { localDateOf } from '../../domain/dates'
import { formatLongDate, formatRelativeDate } from '../../domain/format'
import { overdueOccurrences, statusOf, type Occurrence } from '../../domain/occurrences'
import {
  filterOccurrencesByCategories,
  occurrencesForView,
  sortOccurrences,
  viewRange,
  type ListView,
  type SortOrder,
} from '../../domain/views'
import type { Actions } from '../actions'
import { emptyState } from '../components/parts'
import { taskRow, type RowContext, type RowHandlers } from '../components/taskRow'
import { h, icon, type Child } from '../dom'
import { CircleCheck, Inbox, Plus, Sun, TriangleAlert } from '../icons'
import { state } from '../state'
import type { ViewContent } from './shell'

const TITLES: Record<ListView, string> = {
  all: 'All tasks',
  today: 'Today',
  next3: 'Next 3 days',
  week: 'This week',
  overdue: 'Overdue',
}

const EMPTY: Record<ListView, { title: string; text: string }> = {
  all: { title: 'Nothing to do', text: 'Every task is complete. Create a new one when something comes up.' },
  today: { title: 'Nothing due today', text: 'Enjoy the free time, or plan ahead with a new task.' },
  next3: {
    title: 'Nothing due in the next 3 days',
    text: 'Tasks due tomorrow through the next three days appear here.',
  },
  week: { title: 'Nothing due this week', text: 'Tasks due this week, including missed ones, appear here.' },
  overdue: { title: 'No overdue tasks', text: 'You’re all caught up.' },
}

const SORT_OPTIONS: { value: string; label: string; order: SortOrder }[] = [
  { value: 'due-asc', label: 'Due date (soonest first)', order: { key: 'due', direction: 'asc' } },
  { value: 'due-desc', label: 'Due date (latest first)', order: { key: 'due', direction: 'desc' } },
  {
    value: 'priority-desc',
    label: 'Priority (highest first)',
    order: { key: 'priority', direction: 'desc' },
  },
  {
    value: 'priority-asc',
    label: 'Priority (lowest first)',
    order: { key: 'priority', direction: 'asc' },
  },
]

export function newTaskButton(actions: Actions): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      dataset: { focusKey: 'new-task' },
      onClick: () => actions.createTask(),
    },
    icon(Plus, 16),
    'New task',
  )
}

/** Sort control and category filter (FR-11 – FR-13), shared by list views. */
export function listToolbar(options: { showSort: boolean }): Child {
  const { sort, categoryFilter } = state.ui
  const categories = state.data.categories
  const selectedValue = `${sort.key}-${sort.direction}`
  return [
    options.showSort &&
      h(
        'label',
        { class: 'toolbar__group' },
        h('span', { class: 'toolbar__label' }, 'Sort by'),
        h(
          'select',
          {
            class: 'select select--sm',
            dataset: { focusKey: 'sort' },
            onChange: (e: Event) => {
              const option = SORT_OPTIONS.find((o) => o.value === (e.target as HTMLSelectElement).value)
              if (option) state.setUi({ sort: option.order })
            },
          },
          SORT_OPTIONS.map((o) =>
            h('option', { value: o.value, selected: o.value === selectedValue }, o.label),
          ),
        ),
      ),
    categories.length > 0 &&
      h(
        'div',
        { class: 'toolbar__group', role: 'group', 'aria-label': 'Filter by category (matching any)' },
        h('span', { class: 'toolbar__label', 'aria-hidden': 'true' }, 'Categories (any):'),
        categories.map((c) =>
          h(
            'button',
            {
              type: 'button',
              class: 'toggle-chip toggle-chip--sm',
              'aria-pressed': String(categoryFilter.has(c.id)),
              dataset: { focusKey: `filter:${c.id}` },
              onClick: () => {
                const next = new Set(categoryFilter)
                if (next.has(c.id)) next.delete(c.id)
                else next.add(c.id)
                state.setUi({ categoryFilter: next })
              },
            },
            c.name,
          ),
        ),
        categoryFilter.size > 0 &&
          h(
            'button',
            {
              type: 'button',
              class: 'link-btn',
              dataset: { focusKey: 'clear-filters' },
              onClick: () => state.setUi({ categoryFilter: new Set() }),
            },
            'Clear filters',
          ),
      ),
  ]
}

function groupLabel(occ: Occurrence, now: number, view: ListView): string {
  if (view !== 'overdue' && statusOf(occ, now) === 'overdue') return 'Overdue'
  return formatRelativeDate(occ.date, now)
}

function summaryFor(view: ListView, now: number, count: number, overdue: number): string {
  const parts = [count === 1 ? '1 task' : `${count} tasks`]
  if (overdue > 0 && view !== 'overdue') parts.push(`${overdue} overdue`)
  const range = viewRange(view, now, state.weekStart())
  if (view === 'today') parts.unshift(formatLongDate(localDateOf(now)))
  else if (range)
    parts.unshift(`${formatRelativeDate(range.from, now)} – ${formatRelativeDate(range.to, now)}`)
  return parts.join(' · ')
}

export function listView(view: ListView, actions: Actions): ViewContent {
  const now = actions.now()
  const { sort, categoryFilter } = state.ui
  const all = occurrencesForView(state.data.tasks, view, now, state.weekStart())
  const shown = sortOccurrences(filterOccurrencesByCategories(all, categoryFilter), sort)
  const overdueCount = shown.filter((o) => statusOf(o, now) === 'overdue').length

  const ctx: RowContext = { now, weekStart: state.weekStart(), categoryName: (id) => state.categoryName(id) }
  const handlers: RowHandlers = {
    onComplete: (occ, row, check) => void actions.completeOccurrence(occ, row, check),
    onOpen: (occ) => actions.openDetail(occ),
    onEdit: (occ) => actions.editOccurrence(occ),
    onSkip: (occ) => void actions.skipOccurrence(occ),
    onDelete: (occ) => void actions.deleteOccurrence(occ),
  }

  // Recurring tasks with a backlog of missed occurrences get a one-click way to clear it.
  const backlog =
    view === 'all' || view === 'overdue'
      ? state.data.tasks
          .filter((t) => t.recurrence.kind !== 'once')
          .map((t) => ({ task: t, missed: overdueOccurrences(t, now).length }))
          .filter((b) => b.missed > 1)
      : []

  let body: Child
  if (shown.length === 0) {
    const firstRun = state.data.tasks.length === 0 && state.data.archive.length === 0
    if (firstRun) {
      body = emptyState({
        art: 'mark',
        title: 'Welcome to Task Tracker',
        text: 'Create your first task to start tracking what’s due. You can add repeats, categories and reminders.',
        action: newTaskButton(actions),
      })
    } else if (categoryFilter.size > 0 && all.length > 0) {
      body = emptyState({
        art: Inbox,
        title: 'No tasks match these categories',
        text: 'Try other categories, or clear the filter to see everything in this view.',
        action: h(
          'button',
          { type: 'button', class: 'btn', onClick: () => state.setUi({ categoryFilter: new Set() }) },
          'Clear filters',
        ),
      })
    } else {
      body = emptyState({ art: view === 'today' ? Sun : CircleCheck, ...EMPTY[view] })
    }
  } else if (sort.key === 'due') {
    const groups = new Map<string, Occurrence[]>()
    for (const occ of shown) {
      const label = groupLabel(occ, now, view)
      groups.set(label, [...(groups.get(label) ?? []), occ])
    }
    body = [...groups].map(([label, items]) =>
      h(
        'section',
        { class: 'list-group', 'aria-label': label },
        h('h2', { class: 'list-group__heading' }, label, h('span', null, `· ${items.length}`)),
        h(
          'ul',
          { class: 'task-list' },
          items.map((occ) => taskRow(occ, ctx, handlers)),
        ),
      ),
    )
  } else {
    body = h(
      'ul',
      { class: 'task-list', 'aria-label': TITLES[view] },
      shown.map((occ) => taskRow(occ, ctx, handlers)),
    )
  }

  return {
    title: TITLES[view],
    summary: summaryFor(view, now, shown.length, overdueCount),
    headerAction: newTaskButton(actions),
    toolbar: all.length > 0 || categoryFilter.size > 0 ? listToolbar({ showSort: true }) : undefined,
    body: [
      backlog.map(({ task, missed }) =>
        h(
          'div',
          { class: 'banner banner--danger' },
          icon(TriangleAlert, 18),
          h('span', { class: 'banner__text' }, `“${task.title}” has ${missed} missed occurrences.`),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--sm',
              dataset: { focusKey: `skip-missed:${task.id}` },
              onClick: () => void actions.skipAllMissed(task.id),
            },
            'Skip all missed',
          ),
        ),
      ),
      body,
    ],
  }
}
