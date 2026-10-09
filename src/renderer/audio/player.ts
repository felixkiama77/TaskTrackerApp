import type { Settings } from '../../domain/types'
import type { AudioCatalog, EffectCue, NotificationCue, Track } from './catalog'
import { Playlist } from './playlist'

/**
 * Plays the app's custom sounds: action effects, notification sounds and background music.
 *
 * - Sounds are only ever an extra cue; every event also has visible text.
 * - A cue without a file is a no-op (`play…` returns false), so callers can fall back.
 * - Music plays only while enabled, the window is visible, and tracks exist. It dips while an
 *   effect or notification sound plays, skips tracks that fail to load, and stops if none work.
 */
export interface AudioLike {
  volume: number
  currentTime: number
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended' | 'error', listener: () => void, options?: { once?: boolean }): void
  removeAttribute(name: 'src'): void
  load(): void
}

export type SoundSettings = Pick<
  Settings,
  | 'playSound'
  | 'notificationVolume'
  | 'soundEffects'
  | 'effectsVolume'
  | 'music'
  | 'musicVolume'
  | 'musicShuffle'
>

export interface PlayerDeps {
  catalog: AudioCatalog
  settings: () => SoundSettings
  createAudio?: (url: string) => AudioLike
  isVisible?: () => boolean
  random?: () => number
}

/** Music volume multiplier while another sound plays. */
export const DUCK_FACTOR = 0.35
/** Safety limit for how long music stays ducked if an "ended" event never arrives. */
export const MAX_DUCK_MS = 8000

export class SoundPlayer {
  private readonly createAudio: (url: string) => AudioLike
  private readonly isVisible: () => boolean
  private readonly playlist: Playlist
  private music: AudioLike | null = null
  private musicTrack: Track | null = null
  private failuresInARow = 0
  private ducks = 0
  private warnedBlocked = false
  private listeners = new Set<() => void>()

  constructor(private readonly deps: PlayerDeps) {
    this.createAudio = deps.createAudio ?? ((url) => new Audio(url))
    this.isVisible = deps.isVisible ?? (() => true)
    this.playlist = new Playlist(deps.catalog.music, deps.settings().musicShuffle, deps.random)
  }

  get catalog(): AudioCatalog {
    return this.deps.catalog
  }

  /** Called whenever "now playing" changes, for the settings screen. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hasNotificationSound(cue: NotificationCue): boolean {
    return this.deps.catalog.notifications[cue] !== undefined
  }

  playEffect(cue: EffectCue): boolean {
    const settings = this.deps.settings()
    const url = this.deps.catalog.effects[cue]
    if (!settings.soundEffects || !url) return false
    return this.playOneShot(url, settings.effectsVolume)
  }

  playNotification(cue: NotificationCue): boolean {
    const settings = this.deps.settings()
    const url = this.deps.catalog.notifications[cue]
    if (!settings.playSound || !url) return false
    return this.playOneShot(url, settings.notificationVolume)
  }

  nowPlaying(): Track | null {
    return this.music ? this.musicTrack : null
  }

  /** Starts, stops or adjusts music to match the settings and window visibility. Safe to call often. */
  syncMusic() {
    const settings = this.deps.settings()
    this.playlist.setShuffle(settings.musicShuffle)
    const shouldPlay =
      settings.music && this.isVisible() && this.playlist.size > 0 && this.failuresInARow < this.playlist.size
    if (!shouldPlay) {
      if (this.music) {
        this.music.pause()
        this.emit()
      }
      // Keep the element so playback resumes where it left off when the window is shown again.
      return
    }
    if (!this.music) this.startTrack(this.playlist.next())
    else {
      this.applyMusicVolume()
      void this.music.play().catch(() => this.warnBlocked())
    }
  }

  /** Skips to the next track (no-op when music is off). */
  nextTrack() {
    if (!this.music) return
    this.stopMusic()
    this.startTrack(this.playlist.next())
  }

  stopMusic() {
    if (!this.music) return
    this.music.pause()
    this.music.removeAttribute('src')
    this.music.load()
    this.music = null
    this.musicTrack = null
    this.emit()
  }

  private startTrack(track: Track | null) {
    if (!track) return
    const audio = this.createAudio(track.url)
    this.music = audio
    this.musicTrack = track
    this.applyMusicVolume()
    audio.addEventListener('ended', () => {
      if (this.music !== audio) return
      this.failuresInARow = 0
      this.music = null
      this.startTrack(this.playlist.next())
    })
    audio.addEventListener('error', () => {
      if (this.music !== audio) return
      console.warn(`[audio] Couldn't play music track "${track.title}"; skipping it.`)
      this.failuresInARow++
      this.music = null
      this.musicTrack = null
      if (this.failuresInARow < this.playlist.size) this.startTrack(this.playlist.next())
      else console.warn('[audio] No music track could be played; background music stopped.')
      this.emit()
    })
    void audio.play().catch(() => this.warnBlocked())
    this.emit()
  }

  private applyMusicVolume() {
    if (!this.music) return
    const base = this.deps.settings().musicVolume
    this.music.volume = this.ducks > 0 ? base * DUCK_FACTOR : base
  }

  private playOneShot(url: string, volume: number): boolean {
    const audio = this.createAudio(url)
    audio.volume = volume
    // Dip the music while this plays.
    this.ducks++
    this.applyMusicVolume()
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.ducks = Math.max(0, this.ducks - 1)
      this.applyMusicVolume()
    }
    audio.addEventListener('ended', release, { once: true })
    audio.addEventListener('error', release, { once: true })
    setTimeout(release, MAX_DUCK_MS)
    audio.play().catch(() => {
      release()
      this.warnBlocked()
    })
    return true
  }

  private warnBlocked() {
    if (this.warnedBlocked) return
    this.warnedBlocked = true
    console.warn('[audio] Playback was blocked or failed; sounds may be unavailable.')
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
