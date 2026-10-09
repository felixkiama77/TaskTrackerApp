import {
  AUDIO_EXTENSIONS,
  EFFECT_CUES,
  NOTIFICATION_CUES,
  titleFromFileName,
  userSoundUrl,
  type EffectCue,
  type NotificationCue,
  type UserSounds,
} from '../../domain/sounds'

/**
 * Where the app's sounds come from. Built-in files in src/assets/audio are discovered at build time;
 * files the user chose in Settings come from the app's data folder and take priority. A cue with
 * neither simply has no custom sound.
 */
export { EFFECT_CUES, NOTIFICATION_CUES, titleFromFileName, type EffectCue, type NotificationCue }

export interface Track {
  /** Stable id: the bundled file name, or the user track's id. */
  id: string
  /** Display name, e.g. "02-calm-morning.mp3" → "Calm morning". */
  title: string
  url: string
  source: 'bundled' | 'user'
}

export interface AudioCatalog {
  effects: Partial<Record<EffectCue, string>>
  notifications: Partial<Record<NotificationCue, string>>
  /** Built-in tracks in file-name order (numeric prefixes control it), then the user's in the order added. */
  music: Track[]
  /** Built-in files whose names don't match a cue (reported so typos are easy to spot). */
  unrecognized: string[]
}

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value)

/**
 * Builds the built-in catalog from discovered files: a map of source path (anything ending in
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
      catalog.music.push({ id: name, title: titleFromFileName(name), url, source: 'bundled' })
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

/** The built-in catalog with the user's own files layered on top. */
export function withUserSounds(bundled: AudioCatalog, user: UserSounds): AudioCatalog {
  const effects = { ...bundled.effects }
  for (const cue of EFFECT_CUES) {
    const sound = user.effects[cue]
    if (sound) effects[cue] = userSoundUrl('effects', sound.file)
  }
  const notifications = { ...bundled.notifications }
  for (const cue of NOTIFICATION_CUES) {
    const sound = user.notifications[cue]
    if (sound) notifications[cue] = userSoundUrl('notifications', sound.file)
  }
  const music: Track[] = [
    ...bundled.music,
    ...user.music.map((t) => ({
      id: t.id,
      title: t.title,
      url: userSoundUrl('music', t.file),
      source: 'user' as const,
    })),
  ]
  return { effects, notifications, music, unrecognized: bundled.unrecognized }
}
