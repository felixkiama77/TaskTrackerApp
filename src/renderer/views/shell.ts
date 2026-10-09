import type { IconNode } from 'lucide'
import type { ListView } from '../../domain/views'
import { brandMark } from '../components/parts'
import { h, icon, type Child } from '../dom'
import {
  Archive,
  Calendar,
  CalendarDays,
  CalendarRange,
  CircleAlert,
  ListTodo,
  Settings,
  Sun,
  Tags,
} from '../icons'
import type { Route } from '../state'

/** What a screen renders into the shared shell (title, summary, primary action, toolbar, body). */
export interface ViewContent {
  title: string
  summary?: Child
  headerAction?: Child
  toolbar?: Child
  body: Child
  /** Calendar uses the full width; lists keep a readable line length. */
  wide?: boolean
}

export interface NavCounts {
  views: Record<ListView, number>
  completed: number
  categories: number
}

interface NavEntry {
  route: Route
  label: string
  icon: IconNode
  count?: number
  alert?: boolean
}

const sameRoute = (a: Route, b: Route) =>
  a.name === b.name && (a.name !== 'list' || (b.name === 'list' && a.view === b.view))

export function routeKey(route: Route): string {
  return route.name === 'list' ? `list:${route.view}` : route.name
}

/**
 * Sidebar (design spec §5): the brand, then one navigation landmark holding the task views, the
 * planning/review screens and Settings.
 */
export function sidebar(current: Route, counts: NavCounts, navigate: (route: Route) => void): Child {
  const item = (entry: NavEntry) =>
    h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          class: 'nav-item',
          'aria-current': sameRoute(entry.route, current) ? 'page' : undefined,
          title: entry.label,
          dataset: { focusKey: `nav:${routeKey(entry.route)}`, alert: String(Boolean(entry.alert)) },
          onClick: () => navigate(entry.route),
        },
        icon(entry.icon, 18),
        h('span', { class: 'nav-item__label' }, entry.label),
        entry.count !== undefined &&
          entry.count > 0 &&
          h(
            'span',
            { class: ['nav-item__count', entry.alert && 'nav-item__count--alert'] },
            h('span', { class: 'visually-hidden' }, ', '),
            String(entry.count),
            entry.alert && h('span', { class: 'visually-hidden' }, ' overdue'),
          ),
      ),
    )

  const { views } = counts
  return [
    h(
      'div',
      { class: 'brand' },
      brandMark(32, 'brand__mark'),
      h('span', { class: 'brand__name' }, 'Task Tracker'),
    ),
    h(
      'nav',
      { class: 'sidebar__nav', 'aria-label': 'Main' },
      h(
        'ul',
        { class: 'nav-list' },
        item({ route: { name: 'list', view: 'all' }, label: 'All tasks', icon: ListTodo, count: views.all }),
        item({ route: { name: 'list', view: 'today' }, label: 'Today', icon: Sun, count: views.today }),
        item({
          route: { name: 'list', view: 'next3' },
          label: 'Next 3 days',
          icon: CalendarRange,
          count: views.next3,
        }),
        item({
          route: { name: 'list', view: 'week' },
          label: 'This week',
          icon: CalendarDays,
          count: views.week,
        }),
        item({
          route: { name: 'list', view: 'overdue' },
          label: 'Overdue',
          icon: CircleAlert,
          count: views.overdue,
          alert: views.overdue > 0,
        }),
      ),
      h('h2', { class: 'nav-section__label' }, 'Plan and review'),
      h(
        'ul',
        { class: 'nav-list' },
        item({ route: { name: 'calendar' }, label: 'Calendar', icon: Calendar }),
        item({ route: { name: 'completed' }, label: 'Completed', icon: Archive, count: counts.completed }),
        item({ route: { name: 'categories' }, label: 'Categories', icon: Tags, count: counts.categories }),
      ),
      h(
        'ul',
        { class: 'nav-list sidebar__footer' },
        item({ route: { name: 'settings' }, label: 'Settings', icon: Settings }),
      ),
    ),
  ]
}
