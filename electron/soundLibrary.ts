import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  detectAudioFormat,
  folderFor,
  MAX_SOUND_BYTES,
  SOUND_FOLDERS,
  STORED_FILE_PATTERN,
  type SoundFolder,
  type SoundSlot,
} from '../src/domain/sounds'

/** A file that can't be used as a sound; the message is shown to the user. */
export class SoundImportError extends Error {
  override name = 'SoundImportError'
}

/**
 * The user's sound files, kept in `<userData>/sounds/{effects,notifications,music}`. Files are only
 * ever created here by copying a file the user picked (after checking its size and that it really
 * is audio), named by the app, and served back by name — never by an arbitrary path.
 */
export class SoundLibrary {
  constructor(readonly root: string) {}

  /** Checks and copies a chosen file into the library; returns the stored name and the original name. */
  async importFile(sourcePath: string, slot: SoundSlot): Promise<{ file: string; originalName: string }> {
    const originalName = path.basename(sourcePath)
    let size: number
    try {
      const stat = await fs.stat(sourcePath)
      if (!stat.isFile()) throw new SoundImportError(`“${originalName}” isn’t a file.`)
      size = stat.size
    } catch (error) {
      if (error instanceof SoundImportError) throw error
      throw new SoundImportError(`“${originalName}” couldn’t be read.`)
    }
    const limit = MAX_SOUND_BYTES[slot.kind]
    if (size === 0) throw new SoundImportError(`“${originalName}” is empty.`)
    if (size > limit) {
      throw new SoundImportError(`“${originalName}” is larger than ${Math.round(limit / (1024 * 1024))} MB.`)
    }

    const head = Buffer.alloc(16)
    const handle = await fs.open(sourcePath, 'r')
    try {
      await handle.read(head, 0, head.length, 0)
    } finally {
      await handle.close()
    }
    const format = detectAudioFormat(head)
    if (!format) {
      throw new SoundImportError(`“${originalName}” doesn’t look like an MP3, OGG, WAV or M4A audio file.`)
    }

    const folder = folderFor(slot)
    const base = slot.kind === 'music' ? randomUUID() : `${slot.cue}-${randomUUID().slice(0, 8)}`
    const file = `${base}.${format}`
    await fs.mkdir(path.join(this.root, folder), { recursive: true })
    await fs.copyFile(sourcePath, path.join(this.root, folder, file))
    return { file, originalName }
  }

  /** Deletes a stored file the app no longer references (missing files are ignored). */
  async deleteFile(folder: SoundFolder, file: string): Promise<void> {
    const full = this.resolve(folder, file)
    if (full) await fs.rm(full, { force: true })
  }

  /**
   * The absolute path of a stored sound, or null unless the folder is one of the library's and the
   * name is one the app could have generated — so requests can never reach other files.
   */
  resolve(folder: string, file: string): string | null {
    if (!(Object.values(SOUND_FOLDERS) as string[]).includes(folder) || !STORED_FILE_PATTERN.test(file))
      return null
    const root = path.resolve(this.root)
    const full = path.resolve(root, folder, file)
    return full.startsWith(root + path.sep) ? full : null
  }
}
