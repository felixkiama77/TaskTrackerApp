import { describe, expect, it } from 'vitest'
import {
  assignSound,
  detectAudioFormat,
  emptyUserSounds,
  referencedSoundFiles,
  removeSound,
  titleFromFileName,
  type UserSound,
} from '../../src/domain/sounds'
import { buildCatalog, withUserSounds, type AudioCatalog, type Track } from '../../src/renderer/audio/catalog'
import { SoundPlayer, type AudioLike } from '../../src/renderer/audio/player'
import { DEFAULT_SETTINGS } from '../../src/domain/types'

const entry = (file: string, originalName = `${file}`): UserSound => ({
  file,
  originalName,
  addedAt: '2026-10-08T00:00:00.000Z',
})

describe('sound files chosen in Settings', () => {
  it('recognizes audio by its content, so renamed non-audio files are rejected', () => {
    const withPadding = (head: number[]) => Uint8Array.from([...head, ...new Array<number>(16).fill(0)])
    const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
    expect(detectAudioFormat(withPadding(ascii('ID3')))).toBe('mp3')
    expect(detectAudioFormat(withPadding([0xff, 0xfb]))).toBe('mp3')
    expect(detectAudioFormat(withPadding(ascii('OggS')))).toBe('ogg')
    expect(detectAudioFormat(withPadding([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]))).toBe('wav')
    expect(detectAudioFormat(withPadding([0, 0, 0, 0, ...ascii('ftypM4A ')]))).toBe('m4a')
    expect(detectAudioFormat(withPadding(ascii('MZ')))).toBeNull() // a program renamed to .mp3
    expect(detectAudioFormat(withPadding(ascii('%PDF-1.7')))).toBeNull()
    expect(detectAudioFormat(Uint8Array.from(ascii('ID')))).toBeNull() // too short to tell
  })

  it('uses the original file name as a readable track title', () => {
    expect(titleFromFileName('03 - Rainy_Afternoon.mp3')).toBe('Rainy Afternoon')
    expect(titleFromFileName('lofi beats.MP3')).toBe('Lofi beats')
  })

  it('a new file for an event replaces the previous one; music tracks accumulate (e.g. 3-10 to shuffle)', () => {
    let sounds = emptyUserSounds()
    ;({ sounds } = assignSound(sounds, { kind: 'notification', cue: 'overdue' }, entry('overdue-a.mp3'), 'x'))
    const replaced = assignSound(
      sounds,
      { kind: 'notification', cue: 'overdue' },
      entry('overdue-b.mp3'),
      'x',
    )
    expect(replaced.replacedFile).toBe('overdue-a.mp3')
    sounds = replaced.sounds
    ;({ sounds } = assignSound(
      sounds,
      { kind: 'effect', cue: 'task-completed' },
      entry('task-completed-a.mp3'),
      'x',
    ))
    for (const id of ['m1', 'm2', 'm3', 'm4']) {
      ;({ sounds } = assignSound(sounds, { kind: 'music' }, entry(`${id}.mp3`, `${id}.mp3`), id))
    }
    expect(sounds.music.map((t) => t.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(referencedSoundFiles(sounds)).toEqual(
      new Set([
        'notifications/overdue-b.mp3',
        'effects/task-completed-a.mp3',
        'music/m1.mp3',
        'music/m2.mp3',
        'music/m3.mp3',
        'music/m4.mp3',
      ]),
    )

    const removedTrack = removeSound(sounds, { kind: 'music' }, 'm2')
    expect(removedTrack.removedFile).toBe('m2.mp3')
    expect(removedTrack.sounds.music.map((t) => t.id)).toEqual(['m1', 'm3', 'm4'])
    const removedEffect = removeSound(sounds, { kind: 'effect', cue: 'task-completed' })
    expect(removedEffect.removedFile).toBe('task-completed-a.mp3')
    expect(removedEffect.sounds.effects).toEqual({})
  })

  it('the user’s files override built-in sounds, and their tracks join the rotation', () => {
    const bundled = buildCatalog({
      '/a/effects/task-completed.mp3': 'builtin:complete',
      '/a/notifications/missed.mp3': 'builtin:missed',
      '/a/music/01-intro.mp3': 'builtin:intro',
    })
    const user = emptyUserSounds()
    user.effects['task-completed'] = entry('task-completed-x1.mp3', 'ding.mp3')
    user.music.push({ ...entry('u1.mp3', 'Rainy Day.mp3'), id: 'u1', title: 'Rainy Day' })
    const merged = withUserSounds(bundled, user)
    expect(merged.effects['task-completed']).toBe('tt-sound://sound/effects/task-completed-x1.mp3')
    expect(merged.notifications.missed).toBe('builtin:missed')
    expect(merged.music.map((t) => [t.title, t.source])).toEqual([
      ['Intro', 'bundled'],
      ['Rainy Day', 'user'],
    ])
  })
})

class FakeAudio implements AudioLike {
  volume = 1
  currentTime = 0
  paused = true
  private listeners: Record<string, (() => void)[]> = { ended: [], error: [] }
  constructor(readonly url: string) {}
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
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

describe('music player with tracks added and removed in Settings', () => {
  const track = (id: string): Track => ({ id, title: id, url: `url-${id}`, source: 'user' })

  it('picks up new tracks and stops a track that was removed while playing', () => {
    const created: FakeAudio[] = []
    const current: { catalog: AudioCatalog } = {
      catalog: { effects: {}, notifications: {}, music: [track('a')], unrecognized: [] },
    }
    const player = new SoundPlayer({
      catalog: () => current.catalog,
      settings: () => ({ ...DEFAULT_SETTINGS, music: true, musicShuffle: false }),
      createAudio: (url) => {
        const audio = new FakeAudio(url)
        created.push(audio)
        return audio
      },
    })
    player.syncMusic()
    expect(created[0].url).toBe('url-a')

    // Two more tracks are added while "a" plays; the rotation continues with them.
    current.catalog = { ...current.catalog, music: [track('a'), track('b'), track('c')] }
    player.syncMusic()
    created[0].fire('ended')
    expect(created[1].url).toBe('url-b')

    // "b" is removed while it plays: it stops and the next remaining track starts.
    current.catalog = { ...current.catalog, music: [track('a'), track('c')] }
    player.syncMusic()
    expect(created[1].paused).toBe(true)
    expect(created[2].url).not.toBe('url-b')
  })
})
