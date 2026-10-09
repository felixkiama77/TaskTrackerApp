import { describe, expect, it } from 'vitest'
import {
  buildCatalog,
  titleFromFileName,
  type AudioCatalog,
  type Track,
} from '../../src/renderer/audio/catalog'
import { DUCK_FACTOR, SoundPlayer, type AudioLike, type SoundSettings } from '../../src/renderer/audio/player'
import { Playlist } from '../../src/renderer/audio/playlist'
import { DEFAULT_SETTINGS } from '../../src/domain/types'

describe('audio catalog', () => {
  it('maps files to cues by folder and name, case-insensitively, in any supported format', () => {
    const catalog = buildCatalog({
      '/src/assets/audio/effects/task-completed.mp3': 'url:complete',
      '/src/assets/audio/effects/ERROR.MP3': 'url:error',
      '/src/assets/audio/notifications/reminder.ogg': 'url:reminder',
      '/src/assets/audio/notifications/overdue.wav': 'url:overdue',
    })
    expect(catalog.effects).toEqual({ 'task-completed': 'url:complete', error: 'url:error' })
    expect(catalog.notifications).toEqual({ reminder: 'url:reminder', overdue: 'url:overdue' })
    expect(catalog.unrecognized).toEqual([])
  })

  it('reports files whose names do not match a cue, so typos are easy to spot', () => {
    const catalog = buildCatalog({
      '/src/assets/audio/effects/task-complete.mp3': 'a', // missing "d"
      '/src/assets/audio/notifications/alarm.mp3': 'b',
      '/src/assets/audio/readme.mp3': 'c',
    })
    expect(catalog.effects).toEqual({})
    expect(catalog.unrecognized).toHaveLength(3)
  })

  it('treats every music file as a track, ordered by name with numeric prefixes', () => {
    const catalog = buildCatalog({
      '/src/assets/audio/music/10-last.mp3': 'u10',
      '/src/assets/audio/music/2-deep_focus.mp3': 'u2',
      '/src/assets/audio/music/01-calm-morning.mp3': 'u1',
    })
    expect(catalog.music.map((t) => [t.title, t.url])).toEqual([
      ['Calm morning', 'u1'],
      ['Deep focus', 'u2'],
      ['Last', 'u10'],
    ])
  })

  it('derives readable titles from file names', () => {
    expect(titleFromFileName('03 - rainy_afternoon')).toBe('Rainy afternoon')
    expect(titleFromFileName('lofi')).toBe('Lofi')
    expect(titleFromFileName('2024')).toBe('2024')
  })
})

const tracks = (n: number): Track[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Track ${i}`,
    url: `u${i}`,
    source: 'bundled' as const,
  }))

/** Deterministic pseudo-random numbers for repeatable shuffle tests. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

describe('music playlist rotation', () => {
  it('plays in order and loops when shuffle is off', () => {
    const playlist = new Playlist(tracks(3), false)
    expect(Array.from({ length: 7 }, () => playlist.next()?.id)).toEqual([
      't0',
      't1',
      't2',
      't0',
      't1',
      't2',
      't0',
    ])
  })

  it('shuffled, every round plays each track once and never repeats a track back to back', () => {
    const playlist = new Playlist(tracks(5), true, seeded(42))
    const played = Array.from({ length: 50 }, () => playlist.next()!.id)
    for (let round = 0; round < 10; round++) {
      expect(new Set(played.slice(round * 5, round * 5 + 5)).size).toBe(5)
    }
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1])
  })

  it('handles an empty or single-track playlist', () => {
    expect(new Playlist([], true).next()).toBeNull()
    const single = new Playlist(tracks(1), true, seeded(1))
    expect([single.next()?.id, single.next()?.id]).toEqual(['t0', 't0'])
  })

  it('turning shuffle off continues in order after the current track', () => {
    const playlist = new Playlist(tracks(4), true, seeded(7))
    const current = playlist.next()!
    playlist.setShuffle(false)
    const index = Number(current.id.slice(1))
    expect(playlist.next()?.id).toBe(`t${(index + 1) % 4}`)
  })
})

class FakeAudio implements AudioLike {
  volume = 1
  currentTime = 0
  paused = true
  private listeners: Record<string, (() => void)[]> = { ended: [], error: [] }
  constructor(
    readonly url: string,
    private readonly log: string[],
  ) {}
  play() {
    this.paused = false
    this.log.push(`play ${this.url}`)
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.log.push(`pause ${this.url}`)
  }
  addEventListener(type: 'ended' | 'error', listener: () => void) {
    this.listeners[type].push(listener)
  }
  removeAttribute() {}
  load() {}
  fire(type: 'ended' | 'error') {
    for (const listener of this.listeners[type]) listener()
  }
}

function setup(catalog: Partial<AudioCatalog>, overrides: Partial<SoundSettings> = {}) {
  const log: string[] = []
  const created: FakeAudio[] = []
  const settings: SoundSettings = { ...DEFAULT_SETTINGS, ...overrides }
  const env = { visible: true }
  const current: { catalog: AudioCatalog } = {
    catalog: { effects: {}, notifications: {}, music: [], unrecognized: [], ...catalog },
  }
  const player = new SoundPlayer({
    catalog: () => current.catalog,
    settings: () => settings,
    createAudio: (url) => {
      const audio = new FakeAudio(url, log)
      created.push(audio)
      return audio
    },
    isVisible: () => env.visible,
    random: seeded(3),
  })
  return { player, log, created, settings, env, current }
}

describe('sound player', () => {
  it('plays an effect at the effects volume, and does nothing without a file or when turned off', () => {
    const { player, created, settings } = setup({ effects: { 'task-completed': 'fx' } })
    expect(player.playEffect('task-completed')).toBe(true)
    expect(created[0]).toMatchObject({ url: 'fx', volume: settings.effectsVolume, paused: false })
    expect(player.playEffect('task-deleted')).toBe(false)
    settings.soundEffects = false
    expect(player.playEffect('task-completed')).toBe(false)
    expect(created).toHaveLength(1)
  })

  it('plays notification sounds only when "Play a sound" is on, at the notification volume', () => {
    const { player, created, settings } = setup(
      { notifications: { overdue: 'od' } },
      { notificationVolume: 0.5 },
    )
    expect(player.hasNotificationSound('overdue')).toBe(true)
    expect(player.hasNotificationSound('reminder')).toBe(false)
    expect(player.playNotification('overdue')).toBe(true)
    expect(created[0].volume).toBe(0.5)
    settings.playSound = false
    expect(player.playNotification('overdue')).toBe(false)
  })

  it('starts music only when enabled, visible and tracks exist', () => {
    const off = setup({ music: tracks(2) }, { music: false })
    off.player.syncMusic()
    expect(off.created).toHaveLength(0)

    const hidden = setup({ music: tracks(2) }, { music: true })
    hidden.env.visible = false
    hidden.player.syncMusic()
    expect(hidden.created).toHaveLength(0)

    const empty = setup({}, { music: true })
    empty.player.syncMusic()
    expect(empty.created).toHaveLength(0)

    const on = setup({ music: tracks(2) }, { music: true, musicShuffle: false, musicVolume: 0.4 })
    on.player.syncMusic()
    expect(on.created).toHaveLength(1)
    expect(on.created[0]).toMatchObject({ url: 'u0', volume: 0.4, paused: false })
    expect(on.player.nowPlaying()?.title).toBe('Track 0')
  })

  it('rotates to the next track when one ends, and pauses/resumes with window visibility', () => {
    const { player, created, env } = setup({ music: tracks(2) }, { music: true, musicShuffle: false })
    player.syncMusic()
    created[0].fire('ended')
    expect(created[1].url).toBe('u1')

    env.visible = false
    player.syncMusic()
    expect(created[1].paused).toBe(true)
    env.visible = true
    player.syncMusic()
    expect(created[1].paused).toBe(false)
    expect(created).toHaveLength(2) // resumed, not restarted
  })

  it('skips tracks that fail to load and stops if none can be played', () => {
    const { player, created } = setup({ music: tracks(3) }, { music: true, musicShuffle: false })
    player.syncMusic()
    created[0].fire('error')
    expect(created[1].url).toBe('u1')
    created[1].fire('error')
    created[2].fire('error')
    expect(created).toHaveLength(3)
    expect(player.nowPlaying()).toBeNull()
    player.syncMusic()
    expect(created).toHaveLength(3) // gives up rather than retrying forever
  })

  it('dips the music while an effect plays and restores it afterwards', () => {
    const { player, created } = setup(
      { music: tracks(1), effects: { error: 'fx' } },
      { music: true, musicVolume: 0.4 },
    )
    player.syncMusic()
    const music = created[0]
    player.playEffect('error')
    expect(music.volume).toBeCloseTo(0.4 * DUCK_FACTOR)
    created[1].fire('ended')
    expect(music.volume).toBeCloseTo(0.4)
  })

  it('Next track switches immediately', () => {
    const { player, created } = setup({ music: tracks(3) }, { music: true, musicShuffle: false })
    player.syncMusic()
    player.nextTrack()
    expect(created[0].paused).toBe(true)
    expect(created[1].url).toBe('u1')
  })
})
