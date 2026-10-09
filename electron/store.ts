import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { EFFECT_CUES, NOTIFICATION_CUES, emptyUserSounds, type UserSounds } from '../src/domain/sounds'
import {
  ArchiveRecordSchema,
  CategorySchema,
  IsoTimestampSchema,
  SettingsSchema,
  TaskDefinitionSchema,
  UserSoundEntrySchema,
  UserTrackSchema,
} from '../src/domain/schemas'
import { emptyAppData, type AppData } from '../src/domain/types'
import type { StartupIssue } from '../src/shared/api'

/**
 * Persistence for the whole app state in one JSON file in the user-data folder (FR-33, FR-34).
 *
 * - Writes are atomic (write a temp file, then rename over the real one) and serialized.
 * - The last file that loaded successfully is kept as a `.bak` copy.
 * - Loading validates every record. Invalid records are moved to a quarantine file rather than
 *   dropped, and an unreadable file is set aside (never overwritten) before falling back to the
 *   backup or an empty state.
 */
export const DATA_FILE = 'task-tracker-data.json'
const CURRENT_VERSION = 1

export class UnreadableDataError extends Error {
  override name = 'UnreadableDataError'
}

export interface ParsedData {
  data: AppData
  quarantined: { collection: string; record: unknown; reason: string }[]
}

const AlertsSchema = z.object({
  delivered: z.record(z.string(), z.number()).catch({}),
  lastCheckedAt: z.number().nullable().catch(null),
})
/** Keeps every valid sound entry; an invalid one is dropped on its own (its file is left on disk). */
function parseSounds(raw: unknown): UserSounds {
  const sounds = emptyUserSounds()
  if (!raw || typeof raw !== 'object') return sounds
  const doc = raw as {
    effects?: Record<string, unknown>
    notifications?: Record<string, unknown>
    music?: unknown
  }
  for (const cue of EFFECT_CUES) {
    const parsed = UserSoundEntrySchema.safeParse(doc.effects?.[cue])
    if (parsed.success) sounds.effects[cue] = parsed.data
  }
  for (const cue of NOTIFICATION_CUES) {
    const parsed = UserSoundEntrySchema.safeParse(doc.notifications?.[cue])
    if (parsed.success) sounds.notifications[cue] = parsed.data
  }
  if (Array.isArray(doc.music)) {
    const ids = new Set<string>()
    for (const track of doc.music) {
      const parsed = UserTrackSchema.safeParse(track)
      if (parsed.success && !ids.has(parsed.data.id)) {
        ids.add(parsed.data.id)
        sounds.music.push(parsed.data)
      }
    }
  }
  return sounds
}

const MetaSchema = z.object({ legacyImportedAt: IsoTimestampSchema.nullable().catch(null) })

/**
 * Turns untrusted parsed JSON into valid `AppData`, keeping every valid record. Throws
 * `UnreadableDataError` when the overall structure is not recognizable.
 */
export function parseAppData(raw: unknown): ParsedData {
  if (!raw || typeof raw !== 'object') throw new UnreadableDataError('The data file is not a JSON object.')
  const doc = raw as Record<string, unknown>
  if (doc.version !== CURRENT_VERSION) {
    throw new UnreadableDataError(`Unsupported data version: ${JSON.stringify(doc.version)}.`)
  }
  for (const key of ['tasks', 'categories', 'archive'] as const) {
    if (!Array.isArray(doc[key])) throw new UnreadableDataError(`The data file has no "${key}" list.`)
  }

  const quarantined: ParsedData['quarantined'] = []
  const keepValid = <T>(collection: string, items: unknown[], schema: z.ZodType<T>): T[] => {
    const seen = new Set<string>()
    const result: T[] = []
    for (const record of items) {
      const parsed = schema.safeParse(record)
      if (!parsed.success) {
        quarantined.push({ collection, record, reason: parsed.error.issues[0]?.message ?? 'Invalid record.' })
        continue
      }
      const id = (parsed.data as { id: string }).id
      if (seen.has(id)) {
        quarantined.push({ collection, record, reason: 'Duplicate id.' })
        continue
      }
      seen.add(id)
      result.push(parsed.data)
    }
    return result
  }

  const categories = keepValid('categories', doc.categories as unknown[], CategorySchema)
  const known = new Set(categories.map((c) => c.id))
  // Drop links to categories that no longer exist so nothing references a missing category.
  const tasks = keepValid('tasks', doc.tasks as unknown[], TaskDefinitionSchema).map((t) => ({
    ...t,
    categoryIds: t.categoryIds.filter((id) => known.has(id)),
  }))
  const archive = keepValid('archive', doc.archive as unknown[], ArchiveRecordSchema).map((r) => ({
    ...r,
    categoryIds: r.categoryIds.filter((id) => known.has(id)),
  }))

  return {
    data: {
      version: CURRENT_VERSION,
      tasks,
      categories,
      archive,
      settings: SettingsSchema.parse(doc.settings ?? {}),
      sounds: parseSounds(doc.sounds),
      alerts: AlertsSchema.parse(doc.alerts ?? {}),
      meta: MetaSchema.parse(doc.meta ?? {}),
    },
    quarantined,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Renames with a few retries: on Windows, antivirus or indexing can briefly lock the target. */
async function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error
      await sleep(50 * (attempt + 1))
    }
  }
}

const stamp = (now: number) => new Date(now).toISOString().replace(/[:.]/g, '-')

export class Store {
  private writeQueue: Promise<void> = Promise.resolve()

  private constructor(
    readonly directory: string,
    private data: AppData,
  ) {}

  get filePath() {
    return path.join(this.directory, DATA_FILE)
  }

  /** Loads the data file, recovering as safely as possible. */
  static async open(directory: string, now = Date.now()): Promise<{ store: Store; issues: StartupIssue[] }> {
    await fs.mkdir(directory, { recursive: true })
    const main = path.join(directory, DATA_FILE)
    const backup = `${main}.bak`
    const issues: StartupIssue[] = []

    const readParsed = async (file: string): Promise<ParsedData | null> => {
      let text: string
      try {
        text = await fs.readFile(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      try {
        return parseAppData(JSON.parse(text))
      } catch (error) {
        if (error instanceof SyntaxError) throw new UnreadableDataError('The data file is not valid JSON.')
        throw error
      }
    }

    let parsed: ParsedData | null
    try {
      parsed = await readParsed(main)
      if (parsed) await fs.copyFile(main, backup)
    } catch (error) {
      if (!(error instanceof UnreadableDataError)) throw error
      const asideName = `task-tracker-data.unreadable-${stamp(now)}.json`
      await renameWithRetry(main, path.join(directory, asideName))
      console.error(`[store] ${error.message} Moved it to ${asideName}.`)
      try {
        parsed = await readParsed(backup)
      } catch (backupError) {
        if (!(backupError instanceof UnreadableDataError)) throw backupError
        parsed = null
      }
      issues.push(
        parsed
          ? {
              kind: 'restored-from-backup',
              message: `Your saved data couldn’t be read, so the most recent backup was restored. The unreadable file was kept as ${asideName}.`,
            }
          : {
              kind: 'reset',
              message: `Your saved data couldn’t be read and no usable backup was found. Task Tracker started empty; the unreadable file was kept as ${asideName}.`,
            },
      )
    }

    if (parsed && parsed.quarantined.length > 0) {
      const name = `task-tracker-quarantine-${stamp(now)}.json`
      await fs.writeFile(path.join(directory, name), JSON.stringify(parsed.quarantined, null, 2), 'utf8')
      issues.push({
        kind: 'quarantined',
        message: `${parsed.quarantined.length} saved item(s) were invalid and were set aside in ${name} instead of being loaded.`,
      })
    }

    const store = new Store(directory, parsed?.data ?? emptyAppData())
    // Persist any repairs (or create the file) so what is on disk matches what is in memory.
    if (!parsed || parsed.quarantined.length > 0 || issues.length > 0) await store.replace(store.data)
    return { store, issues }
  }

  get(): AppData {
    return this.data
  }

  /**
   * Replaces the state and persists it. If writing fails, the in-memory state is rolled back so it
   * never diverges from what is on disk, and the error is rethrown.
   */
  replace(next: AppData): Promise<void> {
    const previous = this.data
    this.data = next
    const write = this.writeQueue.then(() => this.write(next))
    this.writeQueue = write.catch(() => undefined)
    return write.catch((error: unknown) => {
      if (this.data === next) this.data = previous
      throw error
    })
  }

  /** Resolves once every queued write has finished. */
  flush(): Promise<void> {
    return this.writeQueue
  }

  private async write(data: AppData) {
    const target = this.filePath
    const temp = `${target}.tmp`
    await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
    await renameWithRetry(temp, target)
  }
}
