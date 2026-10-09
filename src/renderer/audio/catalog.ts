/**
 * The app's sound cues and how audio files map onto them. Files live in src/assets/audio (see the
 * README there) and are discovered at build time, so adding a sound means dropping in a file with
 * the right name — no code changes. A cue without a file simply has no custom sound.
 */

/** Short sounds for actions in the app. File: effects/<cue>.mp3 */
export const EFFECT_CUES = [
  'task-created',
  'task-completed',
  'task-undone',
  'task-deleted',
  'task-skipped',
  'error',
] as const
export type EffectCue = (typeof EFFECT_CUES)[number]

/** One sound per notification kind. File: notifications/<cue>.mp3 */
export const NOTIFICATION_CUES = ['reminder', 'due', 'overdue', 'missed'] as const
export type NotificationCue = (typeof NOTIFICATION_CUES)[number]

/** Supported file types (all play natively in Electron). MP3 is the expected format. */
export const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav', 'm4a'] as const

export interface Track {
  /** File name without extension; stable id used for ordering. */
  id: string
  /** Display name derived from the file name, e.g. "02-calm-morning.mp3" → "Calm morning". */
  title: string
  url: string
}

export interface AudioCatalog {
  effects: Partial<Record<EffectCue, string>>
  notifications: Partial<Record<NotificationCue, string>>
  /** Background music in file-name order; a numeric prefix ("01-", "02-") controls the order. */
  music: Track[]
  /** Files in the audio folders whose names don't match a cue (reported so typos are easy to spot). */
  unrecognized: string[]
}

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value)

/** "01-calm_morning" → "Calm morning" */
export function titleFromFileName(name: string): string {
  const words = name
    .replace(/^\d+[\s._-]*/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const text = words || name
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Builds the catalog from discovered files: a map of source path (anything ending in
 * `<folder>/<name>.<ext>`) to the URL the app can load. Pure, so it can be unit-tested.
 */
export function buildCatalog(files: Record<string, string>): AudioCatalog {
  const catalog: AudioCatalog = { effects: {}, notifications: {}, music: [], unrecognized: [] }
  const pattern = new RegExp(
    `(?:^|/)(effects|notifications|music)/([^/]+)\\.(${AUDIO_EXTENSIONS.join('|')})$`,
    'i',
  )

  for (const [path, url] of Object.entries(files)) {
    const match = pattern.exec(path.replace(/\\/g, '/'))
    if (!match) {
      catalog.unrecognized.push(path)
      continue
    }
    const folder = match[1].toLowerCase()
    const name = match[2]
    const cue = name.toLowerCase()
    if (folder === 'music') {
      catalog.music.push({ id: name, title: titleFromFileName(name), url })
    } else if (folder === 'effects' && isOneOf(EFFECT_CUES, cue)) {
      catalog.effects[cue] ??= url
    } else if (folder === 'notifications' && isOneOf(NOTIFICATION_CUES, cue)) {
      catalog.notifications[cue] ??= url
    } else {
      catalog.unrecognized.push(path)
    }
  }
  catalog.music.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  return catalog
}
