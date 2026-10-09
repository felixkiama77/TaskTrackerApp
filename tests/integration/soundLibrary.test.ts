import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SoundImportError, SoundLibrary } from '../../electron/soundLibrary'

let dir: string
let library: SoundLibrary

/** A tiny but valid WAV header followed by `extra` bytes of silence. */
function wav(extra = 64): Buffer {
  const buffer = Buffer.alloc(44 + extra)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + extra, 4)
  buffer.write('WAVEfmt ', 8)
  return buffer
}

const source = (name: string, content: Buffer) => {
  const file = path.join(dir, 'picked', name)
  writeFileSync(file, content)
  return file
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tasktracker-sounds-'))
  await fs.mkdir(path.join(dir, 'picked'))
  library = new SoundLibrary(path.join(dir, 'library'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SoundLibrary (files chosen in Settings)', () => {
  it('copies a real audio file into the library under an app-generated name', async () => {
    const picked = source('My Chime.wav', wav())
    const { file, originalName } = await library.importFile(picked, { kind: 'effect', cue: 'task-completed' })
    expect(originalName).toBe('My Chime.wav')
    expect(file).toMatch(/^task-completed-[a-f0-9]{8}\.wav$/)
    const stored = library.resolve('effects', file)!
    expect(await fs.readFile(stored)).toEqual(await fs.readFile(picked))
    // The original can be deleted afterwards; the library keeps its own copy.
    await fs.rm(picked)
    await expect(fs.stat(stored)).resolves.toBeTruthy()
  })

  it('names the stored file by detected format, whatever the original extension', async () => {
    const picked = source('actually-wav.mp3', wav())
    const { file } = await library.importFile(picked, { kind: 'music' })
    expect(file).toMatch(/^[a-f0-9-]{36}\.wav$/)
  })

  it('rejects files that are not audio, are empty, or are too large', async () => {
    const exe = source('song.mp3', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]))
    await expect(library.importFile(exe, { kind: 'music' })).rejects.toThrow(SoundImportError)
    await expect(library.importFile(exe, { kind: 'music' })).rejects.toThrow('doesn’t look like')

    const empty = source('empty.mp3', Buffer.alloc(0))
    await expect(library.importFile(empty, { kind: 'effect', cue: 'error' })).rejects.toThrow('is empty')

    const big = source('long.wav', wav(5 * 1024 * 1024 + 1))
    await expect(library.importFile(big, { kind: 'notification', cue: 'overdue' })).rejects.toThrow(
      'larger than 5 MB',
    )

    await expect(library.importFile(path.join(dir, 'missing.mp3'), { kind: 'music' })).rejects.toThrow(
      'couldn’t be read',
    )
    // Nothing was written for any rejected file.
    await expect(fs.readdir(path.join(dir, 'library'))).rejects.toThrow()
  })

  it('only ever serves files from its own folders with app-generated names', () => {
    expect(library.resolve('effects', 'task-completed-1a2b3c4d.mp3')).toBe(
      path.join(dir, 'library', 'effects', 'task-completed-1a2b3c4d.mp3'),
    )
    expect(library.resolve('effects', '../../secrets.mp3')).toBeNull()
    expect(library.resolve('..', 'task-tracker-data.json')).toBeNull()
    expect(library.resolve('other', 'a.mp3')).toBeNull()
    expect(library.resolve('music', 'UPPER.mp3')).toBeNull()
    expect(library.resolve('music', 'a.exe')).toBeNull()
    expect(library.resolve('music', 'a.mp3/../../x.mp3')).toBeNull()
  })

  it('deletes a replaced or removed file, and ignores names it could not have created', async () => {
    const { file } = await library.importFile(source('a.wav', wav()), { kind: 'notification', cue: 'missed' })
    await library.deleteFile('notifications', file)
    await expect(fs.stat(path.join(dir, 'library', 'notifications', file))).rejects.toThrow()
    await expect(library.deleteFile('notifications', '../../picked/a.wav')).resolves.toBeUndefined()
    await expect(fs.stat(path.join(dir, 'picked', 'a.wav'))).resolves.toBeTruthy()
  })
})
