import { localeWeekStart } from '../../domain/dates'
import type { Settings } from '../../domain/types'
import type { AppInfo } from '../../shared/api'
import type { Actions } from '../actions'
import { EFFECT_LABELS, NOTIFICATION_LABELS, type SoundSlot, type UserSound } from '../../domain/sounds'
import { EFFECT_CUES, NOTIFICATION_CUES, type Track } from '../audio/catalog'
import { brandMark } from '../components/parts'
import { h, icon, mount, type Child } from '../dom'
import { BellRing, FolderOpen, Music, Play, SkipForward, Trash, Upload } from '../icons'
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

const percent = (volume: number) => `${Math.round(volume * 100)}%`

/** A 0-100% volume slider; the value is saved when the user lets go. */
function volumeSetting(options: {
  label: string
  value: number
  disabled: boolean
  focusKey: string
  onCommit: (volume: number) => void
}): HTMLElement {
  const id = `setting-${options.focusKey}`
  const output = h('output', { for: id, class: 'setting__hint volume-value' }, percent(options.value))
  const input = h('input', {
    id,
    type: 'range',
    class: 'range',
    min: 0,
    max: 100,
    step: 5,
    value: String(Math.round(options.value * 100)),
    disabled: options.disabled,
    'aria-valuetext': percent(options.value),
    dataset: { focusKey: options.focusKey },
    onInput: (e: Event) => {
      const volume = Number((e.target as HTMLInputElement).value) / 100
      output.textContent = percent(volume)
      input.setAttribute('aria-valuetext', percent(volume))
    },
    onChange: (e: Event) => options.onCommit(Number((e.target as HTMLInputElement).value) / 100),
  })
  return setting(options.label, null, [input, output], id)
}

/** One event's sound: what plays now, with preview, choose and remove. */
function soundRow(options: {
  actions: Actions
  slot: SoundSlot
  label: string
  userFile: UserSound | undefined
  url: string | undefined
  fallback: string
  volume: number
}): HTMLLIElement {
  const { actions, slot, label, userFile, url } = options
  const key = slot.kind === 'music' ? 'music' : `${slot.kind}:${slot.cue}`
  const status = userFile ? `Your file: ${userFile.originalName}` : url ? 'Built-in sound' : options.fallback
  return h(
    'li',
    { class: 'sound-row' },
    h(
      'div',
      { class: 'sound-row__text' },
      h('span', { class: 'sound-row__label' }, label),
      h('span', { class: 'setting__hint' }, status),
    ),
    h(
      'div',
      { class: 'sound-row__actions' },
      url &&
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Play the “${label}” sound`,
            title: 'Play',
            dataset: { focusKey: `sound-play:${key}` },
            onClick: () => actions.sounds.preview(url, options.volume),
          },
          icon(Play, 16),
        ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--sm',
          'aria-label': `Choose a file for “${label}”`,
          dataset: { focusKey: `sound-choose:${key}` },
          onClick: (e: Event) => {
            const button = e.currentTarget as HTMLButtonElement
            button.disabled = true
            void actions.chooseSound(slot, label).finally(() => (button.disabled = false))
          },
        },
        icon(Upload, 14),
        userFile ? 'Replace…' : 'Choose file…',
      ),
      userFile &&
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn icon-btn--danger',
            'aria-label': `Remove your “${label}” sound`,
            title: 'Remove',
            dataset: { focusKey: `sound-remove:${key}` },
            onClick: () => void actions.removeSound(slot, label),
          },
          icon(Trash, 16),
        ),
    ),
  )
}

function musicTrackRow(actions: Actions, track: Track, playingUrl: string | undefined): HTMLLIElement {
  return h(
    'li',
    { class: 'sound-row' },
    h(
      'div',
      { class: 'sound-row__text' },
      h('span', { class: 'sound-row__label' }, icon(Music, 14), track.title),
      h(
        'span',
        { class: 'setting__hint' },
        track.source === 'user' ? 'Added by you' : 'Built-in',
        playingUrl === track.url ? ' · Playing now' : '',
      ),
    ),
    track.source === 'user' &&
      h(
        'div',
        { class: 'sound-row__actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn icon-btn--danger',
            'aria-label': `Remove the track “${track.title}”`,
            title: 'Remove',
            dataset: { focusKey: `track-remove:${track.id}` },
            onClick: () => void actions.removeSound({ kind: 'music' }, track.title, track.id),
          },
          icon(Trash, 16),
        ),
      ),
  )
}

/**
 * Settings › Sound: a sound for each notification and action, and background music tracks. Files are
 * chosen with the system file picker and copied into the app's data folder; built-in sounds from
 * src/assets/audio are used wherever the user hasn't chosen one.
 */
function soundSection(actions: Actions): HTMLElement {
  const settings = state.data.settings
  const userSounds = state.data.sounds
  const { sounds } = actions
  const { catalog } = sounds
  const effectCount = EFFECT_CUES.filter((cue) => catalog.effects[cue]).length
  const customNotifications = NOTIFICATION_CUES.filter((cue) => catalog.notifications[cue])
  const tracks = catalog.music
  const playing = sounds.nowPlaying()
  const trackCount = tracks.length === 1 ? '1 track' : `${tracks.length} tracks`

  const addTracks = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--sm',
      dataset: { focusKey: 'add-tracks' },
      onClick: () => {
        addTracks.disabled = true
        void actions.chooseSound({ kind: 'music' }, 'Music').finally(() => (addTracks.disabled = false))
      },
    },
    icon(Upload, 14),
    'Add tracks…',
  )

  return h(
    'section',
    { class: 'settings-section', 'aria-labelledby': 'settings-sound' },
    h('h2', { id: 'settings-sound' }, 'Sound'),
    h(
      'p',
      { class: 'setting__hint' },
      'Choose an MP3 (or OGG, WAV, M4A) for any event. Files are copied into Task Tracker, so the originals can be moved or deleted afterwards.',
    ),

    h('h3', { class: 'settings-subheading', id: 'sound-notifications' }, 'Notification sounds'),
    h(
      'p',
      { class: 'setting__hint' },
      customNotifications.length === 0
        ? 'Notifications currently use the Windows sound.'
        : 'A sound chosen here replaces the Windows sound for that kind of notification.',
    ),
    h(
      'ul',
      { class: 'sound-list', 'aria-labelledby': 'sound-notifications' },
      NOTIFICATION_CUES.map((cue) =>
        soundRow({
          actions,
          slot: { kind: 'notification', cue },
          label: NOTIFICATION_LABELS[cue],
          userFile: userSounds.notifications[cue],
          url: catalog.notifications[cue],
          fallback: 'Windows sound',
          volume: settings.notificationVolume,
        }),
      ),
    ),
    volumeSetting({
      label: 'Notification sound volume',
      value: settings.notificationVolume,
      disabled: customNotifications.length === 0 || !settings.playSound,
      focusKey: 'notification-volume',
      onCommit: (volume) => {
        save(actions, { notificationVolume: volume })
        const sample = customNotifications[0]
        if (sample) window.setTimeout(() => sounds.playNotification(sample), 50)
      },
    }),

    h('h3', { class: 'settings-subheading', id: 'sound-effects' }, 'Action sounds'),
    switchRow({
      label: 'Play action sounds',
      hint:
        effectCount === 0
          ? 'Choose sounds below; nothing plays until you do.'
          : `${effectCount} of ${EFFECT_CUES.length} actions have a sound.`,
      checked: settings.soundEffects,
      focusKey: 'sound-effects',
      onChange: (checked) => save(actions, { soundEffects: checked }),
    }),
    h(
      'ul',
      { class: 'sound-list', 'aria-labelledby': 'sound-effects' },
      EFFECT_CUES.map((cue) =>
        soundRow({
          actions,
          slot: { kind: 'effect', cue },
          label: EFFECT_LABELS[cue],
          userFile: userSounds.effects[cue],
          url: catalog.effects[cue],
          fallback: 'No sound',
          volume: settings.effectsVolume,
        }),
      ),
    ),
    volumeSetting({
      label: 'Action sound volume',
      value: settings.effectsVolume,
      disabled: effectCount === 0 || !settings.soundEffects,
      focusKey: 'effects-volume',
      onCommit: (volume) => {
        save(actions, { effectsVolume: volume })
        const sample = EFFECT_CUES.find((cue) => catalog.effects[cue])
        if (sample) window.setTimeout(() => sounds.playEffect(sample), 50)
      },
    }),

    h('h3', { class: 'settings-subheading', id: 'sound-music' }, 'Background music'),
    switchRow({
      label: 'Play background music',
      hint:
        tracks.length === 0
          ? 'Add tracks below to start a playlist.'
          : `${trackCount} in rotation. Pauses while the window is hidden.`,
      checked: settings.music,
      focusKey: 'music',
      onChange: (checked) => save(actions, { music: checked }),
    }),
    switchRow({
      label: 'Shuffle',
      hint: 'Play the tracks in a random order, never the same one twice in a row.',
      checked: settings.musicShuffle,
      focusKey: 'music-shuffle',
      onChange: (checked) => save(actions, { musicShuffle: checked }),
    }),
    volumeSetting({
      label: 'Music volume',
      value: settings.musicVolume,
      disabled: tracks.length === 0 || !settings.music,
      focusKey: 'music-volume',
      onCommit: (volume) => save(actions, { musicVolume: volume }),
    }),
    playing &&
      setting(
        'Now playing',
        playing.title,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--sm',
            dataset: { focusKey: 'next-track' },
            onClick: () => sounds.nextTrack(),
          },
          icon(SkipForward, 14),
          'Next track',
        ),
      ),
    tracks.length > 0 &&
      h(
        'ul',
        { class: 'sound-list', 'aria-label': 'Music tracks' },
        tracks.map((track) => musicTrackRow(actions, track, playing?.url)),
      ),
    h(
      'div',
      { class: 'sound-add' },
      addTracks,
      h('span', { class: 'setting__hint' }, 'You can select several files at once (hold Ctrl or Shift).'),
    ),
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
      hint: 'Uses your custom notification sounds where added, otherwise the system sound.',
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
                if (result.ok) actions.sounds.playNotification('reminder')
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
    body: [notifications, soundSection(actions), calendar, windowSection, data, about],
  }
}
