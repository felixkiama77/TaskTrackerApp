import { localDateOf, startOfMonth } from '../domain/dates'
import { viewCounts } from '../domain/views'
import type { AlertMessage, AppInfo, TaskTrackerApi } from '../shared/api'
import { Actions } from './actions'
import { createSoundPlayer } from './audio'
import { NOTIFICATION_CUES } from './audio/catalog'
import { clock, startMinuteTicker } from './clock'
import { EdgeAlert } from './components/edgeAlert'
import { brandMark } from './components/parts'
import { Toaster } from './components/toast'
import { h, mount } from './dom'
import { state, type Route } from './state'
import { calendarView } from './views/calendar'
import { categoriesView } from './views/categories'
import { completedView } from './views/completed'
import { openFromNotification } from './views/detail'
import { listView } from './views/list'
import { settingsView } from './views/settings'
import { routeKey, sidebar, type ViewContent } from './views/shell'

const focusKeyOf = (el: Element | null) => (el instanceof HTMLElement ? el.dataset.focusKey : undefined)

interface Draft {
  value: string
  start: number | null
  end: number | null
}

/**
 * Keeps keyboard focus and half-typed text stable across re-renders (e.g. the per-minute refresh).
 * If the focused control disappeared (e.g. its row was completed), focus moves to the next control
 * that still exists, then the previous one.
 */
function captureFocus(container: HTMLElement) {
  const focused = focusKeyOf(document.activeElement)
  const order = [...container.querySelectorAll<HTMLElement>('[data-focus-key]')].map(
    (el) => el.dataset.focusKey!,
  )
  const drafts = new Map<string, Draft>()
  const textFields = container.querySelectorAll<HTMLInputElement>(
    'input[data-focus-key]:not([type="checkbox"]):not([type="radio"])',
  )
  for (const field of textFields) {
    drafts.set(field.dataset.focusKey!, {
      value: field.value,
      start: field.selectionStart,
      end: field.selectionEnd,
    })
  }
  return () => {
    const find = (key: string) =>
      container.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)
    for (const [key, draft] of drafts) {
      const field = find(key)
      if (field instanceof HTMLInputElement && field.value !== draft.value) field.value = draft.value
    }
    if (!focused || document.querySelector('dialog[open]')) return
    const draft = drafts.get(focused)
    const sameField = find(focused)
    if (sameField instanceof HTMLInputElement && draft && draft.start !== null) {
      sameField.focus({ preventScroll: true })
      sameField.setSelectionRange(draft.start, draft.end)
      return
    }
    const index = order.indexOf(focused)
    const candidates = [focused, ...order.slice(index + 1), ...order.slice(0, Math.max(index, 0)).reverse()]
    for (const key of candidates) {
      const el = find(key)
      if (el) return el.focus({ preventScroll: true })
    }
  }
}

function viewFor(route: Route, actions: Actions, info: AppInfo | null): ViewContent {
  switch (route.name) {
    case 'list':
      return listView(route.view, actions)
    case 'calendar':
      return calendarView(actions)
    case 'completed':
      return completedView(actions)
    case 'categories':
      return categoriesView(actions)
    case 'settings':
      return settingsView(actions, info)
  }
}

/** Imports data saved by the previous version (renderer localStorage), once. */
async function importLegacyData(api: TaskTrackerApi, actions: Actions) {
  if (state.data.meta.legacyImportedAt !== null) return
  const read = (key: string) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const tasks = read('Tasks')
  const tags = read('Tags')
  if (tasks === null && tags === null) return
  try {
    const report = await api.importLegacy({ tasks, tags })
    if (report.alreadyImported || report.tasks + report.categories === 0) return
    const notes = [
      report.completed ? `${report.completed} already-completed task(s) went to Completed.` : '',
      report.repairedDates
        ? `${report.repairedDates} task(s) had no readable due date and were set to today.`
        : '',
    ].filter(Boolean)
    actions.toast({
      tone: 'success',
      title: `Imported ${report.tasks} task(s) and ${report.categories} categor${report.categories === 1 ? 'y' : 'ies'} from the previous version`,
      body: notes.join(' ') || undefined,
      duration: 12_000,
    })
  } catch (error) {
    console.error('[app] Legacy import failed', error)
    actions.toast({
      tone: 'error',
      title: 'Couldn’t import tasks from the previous version',
      body: 'Nothing was changed.',
    })
  }
}

export async function startApp(root: HTMLElement, api: TaskTrackerApi) {
  const sidebarEl = h('aside', { class: 'sidebar' })
  const headerEl = h('header', { class: 'page-header' })
  const toolbarEl = h('div', { class: 'toolbar' })
  const contentEl = h('div', { class: 'content' })
  const mainEl = h('main', { class: 'main' }, headerEl, toolbarEl, contentEl)
  const appEl = h('div', { class: 'app', dataset: { ready: 'false' } }, sidebarEl, mainEl)
  const toastRegion = h('div')
  const edgeEl = h('div')
  root.replaceChildren(appEl)
  document.body.append(toastRegion, edgeEl)

  let windowShown = true
  const sounds = createSoundPlayer(
    () => state.data.settings,
    () => state.data.sounds,
    () => windowShown,
  )
  const actions = new Actions(api, new Toaster(toastRegion), sounds)
  const edgeAlert = new EdgeAlert(edgeEl)

  // Show the logo only if loading is actually slow (design spec §7: no artificial splash).
  const splash = h('div', { class: 'splash' }, brandMark(96, 'splash__mark', 'Task Tracker is loading'))
  const splashTimer = setTimeout(() => document.body.append(splash), 150)
  const [snapshot, info] = await Promise.all([api.getSnapshot(), api.getAppInfo().catch(() => null)])
  clearTimeout(splashTimer)
  splash.remove()

  clock.setOffset(info?.clockOffsetMs ?? 0)
  state.setUi({ calendarMonth: startOfMonth(localDateOf(clock.now())) })
  state.setData(snapshot.data)
  for (const issue of snapshot.issues) {
    actions.toast({ tone: 'error', title: 'About your saved data', body: issue.message, duration: 20_000 })
  }

  let lastTransitionKey = ''
  const render = () => {
    const restoreFocus = captureFocus(appEl)
    const route = state.ui.route
    const content = viewFor(route, actions, info)
    const counts = {
      views: viewCounts(state.data.tasks, clock.now(), state.weekStart()),
      completed: state.data.archive.length,
      categories: state.data.categories.length,
    }

    mount(
      sidebarEl,
      sidebar(route, counts, (next) => state.setUi({ route: next })),
    )
    mount(
      headerEl,
      h(
        'div',
        null,
        h('h1', { tabindex: -1, dataset: { focusKey: 'page-title' } }, content.title),
        content.summary && h('p', { class: 'page-header__summary' }, content.summary),
      ),
      content.headerAction,
    )
    toolbarEl.hidden = !content.toolbar
    mount(toolbarEl, content.toolbar)

    // Fade the content only when the screen (or calendar month) changes, not on every refresh.
    const inner = h('div', { class: content.wide ? '' : 'content__inner' }, content.body)
    const transitionKey = `${routeKey(route)}|${inner.querySelector<HTMLElement>('[data-transition-key]')?.dataset.transitionKey ?? ''}`
    const changedScreen = transitionKey.split('|')[0] !== lastTransitionKey.split('|')[0]
    if (transitionKey !== lastTransitionKey) inner.classList.add('view-enter')
    const scrollTop = contentEl.scrollTop
    mount(contentEl, inner)
    contentEl.scrollTop = changedScreen ? 0 : scrollTop
    lastTransitionKey = transitionKey

    document.title = `${content.title} – Task Tracker`
    restoreFocus()
  }

  state.subscribe(render)
  // Background music follows the settings and pauses while the window is hidden.
  state.subscribe(() => sounds.syncMusic())
  document.addEventListener('visibilitychange', () => sounds.syncMusic())
  api.onWindowVisibility((shown) => {
    windowShown = shown
    sounds.syncMusic()
  })
  sounds.onChange(() => {
    if (state.ui.route.name === 'settings') state.refresh()
  })
  sounds.syncMusic()
  // Tell the main process which notification kinds have custom sounds (so their system sound is
  // muted), again whenever the user adds or removes one.
  let reported: string | null = null
  const reportAudio = () => {
    const custom = NOTIFICATION_CUES.filter((cue) => sounds.hasNotificationSound(cue))
    if (custom.join() === reported) return
    reported = custom.join()
    void api
      .reportAudio({ customNotificationSounds: custom })
      .catch((error: unknown) => console.warn('[audio] Could not report sounds', error))
  }
  reportAudio()
  state.subscribe(reportAudio)
  render()
  appEl.dataset.ready = 'true'

  api.onSnapshot((next) => state.setData(next.data))
  api.onAlert((alert: AlertMessage) => {
    edgeAlert.flash(alert.kind === 'overdue' ? 'overdue' : 'reminder')
    sounds.playNotification(alert.kind)
    const { taskId, occurrenceKey } = alert
    actions.toast({
      tone: alert.kind === 'overdue' ? 'overdue' : 'reminder',
      title: alert.title,
      body: alert.body,
      duration: 10_000,
      actions:
        taskId && occurrenceKey
          ? [{ label: 'View task', onClick: () => openFromNotification(taskId, occurrenceKey, actions) }]
          : undefined,
    })
  })
  api.onNavigate(({ taskId, occurrenceKey }) => openFromNotification(taskId, occurrenceKey, actions))

  // Time-sensitive status (today / overdue / calendar colours) follows the clock (FR-29).
  startMinuteTicker(() => state.refresh())

  // Ctrl+N creates a task from anywhere outside a dialog.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !document.querySelector('dialog[open]')) {
      e.preventDefault()
      actions.createTask()
    }
  })

  await importLegacyData(api, actions)
}
