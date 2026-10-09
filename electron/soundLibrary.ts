import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
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

  /**
   * Checks and copies a chosen file into the library; returns the stored name and the original name.
   * The file is opened once and checked, read and copied through that same handle, never beyond the
   * size that was checked, so swapping the file mid-import can't get anything past the checks.
   */
  async importFile(sourcePath: string, slot: SoundSlot): Promise<{ file: string; originalName: string }> {
    const originalName = path.basename(sourcePath)
    let source: FileHandle
    try {
      source = await fs.open(sourcePath, 'r')
    } catch {
      throw new SoundImportError(`“${originalName}” couldn’t be read.`)
    }
    let destination: string | null = null
    try {
      const stat = await source.stat()
      if (!stat.isFile()) throw new SoundImportError(`“${originalName}” isn’t a file.`)
      const limit = MAX_SOUND_BYTES[slot.kind]
      if (stat.size === 0) throw new SoundImportError(`“${originalName}” is empty.`)
      if (stat.size > limit) {
        throw new SoundImportError(
          `“${originalName}” is larger than ${Math.round(limit / (1024 * 1024))} MB.`,
        )
      }

      const head = Buffer.alloc(16)
      await source.read(head, 0, head.length, 0)
      const format = detectAudioFormat(head)
      if (!format) {
        throw new SoundImportError(`“${originalName}” doesn’t look like an MP3, OGG, WAV or M4A audio file.`)
      }

      const folder = folderFor(slot)
      const base = slot.kind === 'music' ? randomUUID() : `${slot.cue}-${randomUUID().slice(0, 8)}`
      const file = `${base}.${format}`
      await fs.mkdir(path.join(this.root, folder), { recursive: true })
      destination = path.join(this.root, folder, file)
      // "wx": never overwrite an existing file.
      const target = await fs.open(destination, 'wx')
      try {
        const chunk = Buffer.alloc(64 * 1024)
        for (let position = 0; position < stat.size;) {
          const { bytesRead } = await source.read(
            chunk,
            0,
            Math.min(chunk.length, stat.size - position),
            position,
          )
          if (bytesRead === 0) break
          await target.write(chunk, 0, bytesRead)
          position += bytesRead
        }
        await target.sync()
      } finally {
        await target.close()
      }
      return { file, originalName }
    } catch (error) {
      if (destination) await fs.rm(destination, { force: true })
      if (error instanceof SoundImportError) throw error
      throw new SoundImportError(`“${originalName}” couldn’t be copied.`)
    } finally {
      await source.close()
    }
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
