import { localeWeekStart } from '../../domain/dates'
import type { Settings } from '../../domain/types'
import type { AppInfo } from '../../shared/api'
import type { Actions } from '../actions'
import { brandMark } from '../components/parts'
import { h, icon, mount, type Child } from '../dom'
import { BellRing, FolderOpen } from '../icons'
import { state } from '../state'
import type { ViewContent } from './shell'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function save(actions: Actions, patch: Partial<Settings>) {
  void actions.dispatch({ type: 'settings/update', patch }).then((result) => {
    if (result.ok && result.changed)
      actions.toast({ tone: 'success', title: 'Settings saved', duration: 2500 })
  })
}

function switchRow(options: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  focusKey: string
  onChange: (checked: boolean) => void
}): HTMLElement {
  const id = `setting-${options.focusKey}`
  return h(
    'div',
    { class: 'switch-row' },
    h(
      'span',
      { class: 'switch-row__text' },
      h('label', { for: id }, options.label),
      options.hint && h('span', { class: 'setting__hint', id: `${id}-hint` }, options.hint),
    ),
    h('input', {
      id,
      type: 'checkbox',
      class: 'switch',
      role: 'switch',
      checked: options.checked,
      disabled: options.disabled,
      'aria-describedby': options.hint ? `${id}-hint` : undefined,
      dataset: { focusKey: options.focusKey },
      onChange: (e: Event) => options.onChange((e.target as HTMLInputElement).checked),
    }),
  )
}

function setting(label: string, hint: string | null, control: Child, labelFor?: string): HTMLElement {
  return h(
    'div',
    { class: 'setting' },
    h(
      'div',
      { class: 'setting__text' },
      labelFor ? h('label', { for: labelFor }, label) : h('span', null, label),
      hint && h('span', { class: 'setting__hint' }, hint),
    ),
    h('div', { class: 'setting__control' }, control),
  )
}

export function settingsView(actions: Actions, info: AppInfo | null): ViewContent {
  const settings = state.data.settings
  const testResult = h('span', { class: 'setting__hint', role: 'status' })
  const localeStart = WEEKDAY_NAMES[localeWeekStart(navigator.language)]

  const notifications = h(
    'section',
    { class: 'settings-section', 'aria-labelledby': 'settings-notifications' },
    h('h2', { id: 'settings-notifications' }, 'Notifications'),
    switchRow({
      label: 'Send reminders',
      hint: 'Show a notification for each task’s reminders, due time and overdue alert.',
      checked: settings.remindersEnabled,
      focusKey: 'reminders-enabled',
      onChange: (checked) => save(actions, { remindersEnabled: checked }),
    }),
    switchRow({
      label: 'Play a sound',
      hint: 'Uses your system’s notification sound.',
      checked: settings.playSound,
      focusKey: 'play-sound',
      onChange: (checked) => save(actions, { playSound: checked }),
    }),
    setting(
      'Reminder time for tasks without a due time',
      'Reminders for date-only tasks are measured from this time on the due date.',
      h('input', {
        id: 'setting-date-only-time',
        class: 'input input--sm',
        type: 'time',
        value: settings.dateOnlyReminderTime,
        required: true,
        dataset: { focusKey: 'date-only-time' },
        onChange: (e: Event) => {
          const value = (e.target as HTMLInputElement).value
          if (value) save(actions, { dateOnlyReminderTime: value })
        },
      }),
      'setting-date-only-time',
    ),
    setting(
      'Test notifications',
      'If nothing appears, check that notifications are on for Task Tracker in Windows Settings › System › Notifications.',
      [
        testResult,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--sm',
            dataset: { focusKey: 'test-notification' },
            onClick: () =>
              void actions.testNotification().then((result) => {
                mount(testResult, result.ok ? 'Sent.' : result.error)
              }),
          },
          icon(BellRing, 14),
          'Send a test notification',
        ),
      ],
    ),
  )

  const weekStartValue = String(settings.weekStart)
  const calendar = h(
    'section',
    { class: 'settings-section', 'aria-labelledby': 'settings-calendar' },
    h('h2', { id: 'settings-calendar' }, 'Calendar and dates'),
    setting(
      'Week starts on',
      'Used by the calendar and the This week view.',
      h(
        'select',
        {
          id: 'setting-week-start',
          class: 'select select--sm',
          dataset: { focusKey: 'week-start' },
          onChange: (e: Event) => {
            const value = (e.target as HTMLSelectElement).value
            save(actions, {
              weekStart: value === 'locale' ? 'locale' : (Number(value) as Settings['weekStart'] & number),
            })
          },
        },
        h(
          'option',
          { value: 'locale', selected: weekStartValue === 'locale' },
          `System setting (${localeStart})`,
        ),
        [0, 1, 6].map((d) =>
          h('option', { value: String(d), selected: weekStartValue === String(d) }, WEEKDAY_NAMES[d]),
        ),
      ),
      'setting-week-start',
    ),
    switchRow({
      label: 'Show completed tasks in the calendar',
      checked: settings.showCompletedInCalendar,
      focusKey: 'settings-show-completed',
      onChange: (checked) => save(actions, { showCompletedInCalendar: checked }),
    }),
  )

  const closeName = 'close-behavior'
  const windowSection = h(
    'section',
    { class: 'settings-section', 'aria-labelledby': 'settings-window' },
    h('h2', { id: 'settings-window' }, 'App window'),
    h(
      'fieldset',
      { class: 'fieldset setting' },
      h('legend', { class: 'visually-hidden' }, 'When I close the window'),
      h(
        'div',
        { class: 'setting__text' },
        h('span', { 'aria-hidden': 'true' }, 'When I close the window'),
        h('span', { class: 'setting__hint' }, 'Reminders only work while Task Tracker is running.'),
      ),
      h(
        'div',
        { class: 'choice-list' },
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name: closeName,
            checked: settings.closeBehavior === 'tray',
            dataset: { focusKey: 'close-tray' },
            onChange: () => save(actions, { closeBehavior: 'tray' }),
          }),
          'Keep running in the system tray',
        ),
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name: closeName,
            checked: settings.closeBehavior === 'quit',
            dataset: { focusKey: 'close-quit' },
            onChange: () => save(actions, { closeBehavior: 'quit' }),
          }),
          'Quit Task Tracker',
        ),
      ),
    ),
    switchRow({
      label: 'Start Task Tracker when I sign in',
      hint: info?.isPackaged
        ? 'Starts in the tray so reminders work without opening the window.'
        : 'Available in the installed app (not while developing).',
      checked: settings.launchAtLogin,
      disabled: !info?.isPackaged,
      focusKey: 'launch-at-login',
      onChange: (checked) => save(actions, { launchAtLogin: checked }),
    }),
  )

  const data = h(
    'section',
    { class: 'settings-section', 'aria-labelledby': 'settings-data' },
    h('h2', { id: 'settings-data' }, 'Your data'),
    setting(
      'Stored on this computer',
      null,
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--sm',
          dataset: { focusKey: 'open-data' },
          onClick: () => void actions.openDataFolder(),
        },
        icon(FolderOpen, 14),
        'Open folder',
      ),
    ),
    info && h('p', { class: 'data-path' }, info.dataDirectory),
    h(
      'p',
      { class: 'setting__hint' },
      'Completed tasks are kept in the Completed list for 90 days after completion.',
    ),
  )

  const about = h(
    'section',
    { class: 'settings-section', 'aria-labelledby': 'settings-about' },
    h('h2', { id: 'settings-about', class: 'visually-hidden' }, 'About'),
    h(
      'div',
      { class: 'about' },
      brandMark(40, '', ''),
      h(
        'div',
        null,
        h('strong', null, 'Task Tracker'),
        h('p', { class: 'setting__hint' }, `Version ${info?.version ?? '—'}`),
      ),
    ),
  )

  return {
    title: 'Settings',
    summary: 'Changes are saved automatically.',
    body: [notifications, calendar, windowSection, data, about],
  }
}
