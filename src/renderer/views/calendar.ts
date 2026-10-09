import {
  addDays,
  addMonths,
  compareDates,
  dateParts,
  localDateOf,
  startOfMonth,
  startOfWeek,
  type LocalDate,
} from '../../domain/dates'
import { formatLongDate, formatMonthYear, formatTime, weekdayHeaders } from '../../domain/format'
import {
  deadline,
  occurrencesBetween,
  statusOf,
  type Occurrence,
  type OccurrenceStatus,
} from '../../domain/occurrences'
import type { ArchiveRecord } from '../../domain/types'
import type { Actions } from '../actions'
import { emptyState } from '../components/parts'
import { h, icon, type Child } from '../dom'
import { Calendar, ChevronLeft, ChevronRight, CircleCheck, Clock, Sun, TriangleAlert } from '../icons'
import { state } from '../state'
import { openArchiveDetail, openDayDialog } from './detail'
import { listToolbar, newTaskButton } from './list'
import type { ViewContent } from './shell'

type CalendarItem =
  | { kind: 'active'; occ: Occurrence; status: OccurrenceStatus; sortAt: number; title: string }
  | { kind: 'completed'; record: ArchiveRecord; sortAt: number; title: string }

const MAX_PER_DAY = 3
const STATUS_TEXT: Record<OccurrenceStatus, string> = {
  future: 'upcoming',
  today: 'due today',
  overdue: 'overdue',
}
const STATUS_ICON = { future: Clock, today: Sun, overdue: TriangleAlert }

/**
 * Collects calendar items for a date range. Active occurrences come from the same occurrence and
 * status logic as the lists (FR-32), and each sits on its original scheduled date — an overdue one
 * stays red on the day it was due (FR-31). Completed ones come from the archive.
 */
function collectItems(from: LocalDate, to: LocalDate, now: number): Map<LocalDate, CalendarItem[]> {
  const filter = state.ui.categoryFilter
  const matches = (ids: string[]) => filter.size === 0 || ids.some((id) => filter.has(id))
  const byDate = new Map<LocalDate, CalendarItem[]>()
  const add = (date: LocalDate, item: CalendarItem) => byDate.set(date, [...(byDate.get(date) ?? []), item])

  for (const task of state.data.tasks) {
    if (!matches(task.categoryIds)) continue
    for (const occ of occurrencesBetween(task, from, to)) {
      if (occ.state !== 'active') continue
      add(occ.date, { kind: 'active', occ, status: statusOf(occ, now), sortAt: occ.dueAt, title: task.title })
    }
  }
  if (state.data.settings.showCompletedInCalendar) {
    for (const record of state.data.archive) {
      if (compareDates(record.dueDate, from) < 0 || compareDates(record.dueDate, to) > 0) continue
      if (!matches(record.categoryIds)) continue
      add(record.dueDate, {
        kind: 'completed',
        record,
        sortAt: deadline(record.dueDate, record.dueTime),
        title: record.title,
      })
    }
  }
  for (const items of byDate.values())
    items.sort((a, b) => a.sortAt - b.sortAt || a.title.localeCompare(b.title))
  return byDate
}

function eventButton(item: CalendarItem, actions: Actions): HTMLButtonElement {
  if (item.kind === 'completed') {
    const { record } = item
    return h(
      'button',
      {
        type: 'button',
        class: 'cal-event cal-event--completed',
        'aria-label': `${record.title}, completed`,
        dataset: { focusKey: `cal:done:${record.id}` },
        onClick: () => openArchiveDetail(record),
      },
      icon(CircleCheck, 12),
      h('span', { class: 'cal-event__text' }, record.title),
    )
  }
  const { occ, status } = item
  const time = occ.dueTime ? formatTime(occ.dueTime) : null
  return h(
    'button',
    {
      type: 'button',
      class: `cal-event cal-event--${status}`,
      'aria-label': `${occ.task.title}, ${STATUS_TEXT[status]}, due ${time ?? 'by end of day'}`,
      dataset: { focusKey: `cal:${occ.taskId}@${occ.key}` },
      onClick: () => actions.openDetail(occ),
    },
    icon(STATUS_ICON[status], 12),
    time && h('span', { class: 'cal-event__time' }, time),
    h('span', { class: 'cal-event__text' }, occ.task.title),
  )
}

function legend(): HTMLElement {
  const entry = (tone: string, label: string) =>
    h(
      'span',
      { class: 'legend__item' },
      h('span', { class: `legend__swatch legend__swatch--${tone}` }),
      label,
    )
  return h(
    'div',
    { class: 'legend', 'aria-label': 'Legend' },
    entry('future', 'Upcoming'),
    entry('today', 'Due today'),
    entry('overdue', 'Overdue'),
    state.data.settings.showCompletedInCalendar && entry('completed', 'Completed'),
  )
}

function header(actions: Actions, month: LocalDate, today: LocalDate): HTMLElement {
  const go = (to: LocalDate) => state.setUi({ calendarMonth: to })
  const { calendarMode } = state.ui
  return h(
    'div',
    { class: 'calendar-header' },
    h(
      'div',
      { class: 'calendar-header__nav' },
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Previous month',
          dataset: { focusKey: 'cal-prev' },
          onClick: () => go(addMonths(month, -1)),
        },
        icon(ChevronLeft, 18),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--sm',
          dataset: { focusKey: 'cal-today' },
          onClick: () => go(startOfMonth(today)),
        },
        'Today',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Next month',
          dataset: { focusKey: 'cal-next' },
          onClick: () => go(addMonths(month, 1)),
        },
        icon(ChevronRight, 18),
      ),
    ),
    h('h2', { class: 'calendar-header__title', 'aria-live': 'polite' }, formatMonthYear(month)),
    h('span', { class: 'calendar-header__spacer' }),
    h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': 'Calendar layout' },
      (['month', 'agenda'] as const).map((mode) =>
        h(
          'label',
          { class: 'segmented__option' },
          h('input', {
            type: 'radio',
            name: 'calendar-mode',
            checked: calendarMode === mode,
            dataset: { focusKey: `cal-mode:${mode}` },
            onChange: () => state.setUi({ calendarMode: mode }),
          }),
          h('span', null, mode === 'month' ? 'Month' : 'Agenda'),
        ),
      ),
    ),
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'checkbox',
        class: 'switch',
        role: 'switch',
        checked: state.data.settings.showCompletedInCalendar,
        dataset: { focusKey: 'cal-show-completed' },
        onChange: (e: Event) =>
          void actions.dispatch({
            type: 'settings/update',
            patch: { showCompletedInCalendar: (e.target as HTMLInputElement).checked },
          }),
      }),
      'Show completed',
    ),
  )
}

function monthGrid(month: LocalDate, today: LocalDate, now: number, actions: Actions): Child {
  const weekStart = state.weekStart()
  const gridStart = startOfWeek(month, weekStart)
  const monthEnd = addDays(addMonths(month, 1), -1)
  const gridEnd = addDays(startOfWeek(monthEnd, weekStart), 6)
  const items = collectItems(gridStart, gridEnd, now)
  const { month: monthNumber } = dateParts(month)

  const cells: HTMLElement[] = []
  for (let date = gridStart; compareDates(date, gridEnd) <= 0; date = addDays(date, 1)) {
    const dayItems = items.get(date) ?? []
    const outside = dateParts(date).month !== monthNumber
    const visible = dayItems.slice(0, dayItems.length > MAX_PER_DAY ? MAX_PER_DAY - 1 : MAX_PER_DAY)
    const hidden = dayItems.length - visible.length
    const label = `${formatLongDate(date)}${date === today ? ', today' : ''}${
      dayItems.length ? `, ${dayItems.length} ${dayItems.length === 1 ? 'item' : 'items'}` : ''
    }`
    const day = date
    cells.push(
      h(
        'section',
        {
          class: [
            'calendar-day',
            outside && 'calendar-day--outside',
            date === today && 'calendar-day--today',
          ],
          'aria-label': label,
        },
        h('span', { class: 'calendar-day__number', 'aria-hidden': 'true' }, String(dateParts(date).day)),
        visible.map((item) => eventButton(item, actions)),
        hidden > 0 &&
          h(
            'button',
            {
              type: 'button',
              class: 'link-btn calendar-day__more',
              'aria-label': `Show all ${dayItems.length} items on ${formatLongDate(day)}`,
              dataset: { focusKey: `cal-more:${day}` },
              onClick: () =>
                openDayDialog(
                  day,
                  dayItems.map((item) => eventButton(item, actions)),
                  now,
                ),
            },
            `+${hidden} more`,
          ),
      ),
    )
  }

  return h(
    'div',
    { class: 'calendar-grid' },
    weekdayHeaders(weekStart).map((d) =>
      h('div', { class: 'calendar-grid__weekday', 'aria-hidden': 'true', title: d.long }, d.short),
    ),
    cells,
  )
}

function agenda(month: LocalDate, now: number, actions: Actions): Child {
  const monthEnd = addDays(addMonths(month, 1), -1)
  const items = collectItems(month, monthEnd, now)
  const days = [...items.keys()].sort(compareDates)
  if (days.length === 0) {
    return emptyState({
      art: Calendar,
      title: 'Nothing scheduled this month',
      text: 'Use the arrows to look at other months.',
    })
  }
  return days.map((date) =>
    h(
      'section',
      { class: 'agenda-day', 'aria-label': formatLongDate(date) },
      h('h3', { class: 'list-group__heading' }, formatLongDate(date)),
      h(
        'div',
        { class: 'agenda-list' },
        (items.get(date) ?? []).map((item) => eventButton(item, actions)),
      ),
    ),
  )
}

export function calendarView(actions: Actions): ViewContent {
  const now = actions.now()
  const today = localDateOf(now)
  const month = state.ui.calendarMonth
  return {
    title: 'Calendar',
    summary: 'Scheduled tasks by due date, including each repeat.',
    headerAction: newTaskButton(actions),
    toolbar: state.data.categories.length > 0 ? listToolbar({ showSort: false }) : undefined,
    wide: true,
    body: [
      header(actions, month, today),
      legend(),
      h(
        'div',
        { dataset: { transitionKey: `calendar:${state.ui.calendarMode}:${month}` } },
        state.ui.calendarMode === 'month'
          ? monthGrid(month, today, now, actions)
          : agenda(month, now, actions),
      ),
    ],
  }
}
