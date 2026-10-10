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
import { emptyAppData, emptyImportState, type AppData, type ImportState } from '../src/domain/types'
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
/** A copy of the file as it was before an upgrade changed its format. Written once, never overwritten. */
export const PRE_UPGRADE_COPY = (version: number) => `task-tracker-data.v${version}-before-upgrade.json`
const CURRENT_VERSION = 2

export class UnreadableDataError extends Error {
  override name = 'UnreadableDataError'
}

/**
 * The data file was saved by a newer version of the app. It is left exactly where it is: setting it
 * aside and starting empty would hide the user's tasks behind an outdated install.
 */
export class NewerVersionError extends Error {
  override name = 'NewerVersionError'
  constructor(readonly version: number) {
    super(`The data file was saved by a newer version of Task Tracker (data format ${version}).`)
  }
}

export interface ParsedData {
  data: AppData
  quarantined: { collection: string; record: unknown; reason: string }[]
  /** The file's version when it was older than this app's and was upgraded while loading. */
  upgradedFrom: number | null
}

const V1_PRIORITY: Record<string, string> = { easy: 'low', medium: 'medium', hard: 'high' }

/**
 * Version 1 → 2: "difficulty" became "priority" (Easy → Low, Medium → Medium, Hard → High) and tasks
 * gained notes, a link and an import source. Records are only reshaped here; they are validated after.
 */
function upgradeFromV1(doc: Record<string, unknown>): Record<string, unknown> {
  const reshape = (record: unknown, isTask: boolean): unknown => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record
    const { difficulty, ...rest } = record as Record<string, unknown>
    const priority = typeof difficulty === 'string' ? V1_PRIORITY[difficulty] : undefined
    return isTask ? { ...rest, priority, notes: '', link: null, source: null } : { ...rest, priority }
  }
  return {
    ...doc,
    version: 2,
    tasks: (doc.tasks as unknown[]).map((t) => reshape(t, true)),
    archive: (doc.archive as unknown[]).map((r) => reshape(r, false)),
  }
}

const ImportReportSchema = z.object({
  file: z.string().max(260),
  origin: z.string().max(100),
  at: IsoTimestampSchema,
  error: z.string().max(500).nullable(),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  notes: z.array(z.string().max(500)).max(200),
})

function parseImports(raw: unknown): ImportState {
  const state = emptyImportState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state
  const doc = raw as Record<string, unknown>
  const strings = z.record(z.string().max(400), z.string().max(200))
  state.folder = z
    .string()
    .min(1)
    .max(1000)
    .nullable()
    .catch(null)
    .parse(doc.folder ?? null)
  state.seen = strings.catch({}).parse(doc.seen)
  state.files = strings.catch({}).parse(doc.files)
  if (Array.isArray(doc.reports)) {
    for (const report of doc.reports.slice(0, 20)) {
      const parsed = ImportReportSchema.safeParse(report)
      if (parsed.success) state.reports.push(parsed.data)
    }
  }
  return state
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

/** A malformed section (e.g. "settings": "x") falls back to defaults instead of stopping startup. */
const objectOrEmpty = (value: unknown): object =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}

const MetaSchema = z.object({ legacyImportedAt: IsoTimestampSchema.nullable().catch(null) })

/**
 * Turns untrusted parsed JSON into valid `AppData`, keeping every valid record. Throws
 * `UnreadableDataError` when the overall structure is not recognizable.
 */
export function parseAppData(raw: unknown): ParsedData {
  if (!raw || typeof raw !== 'object') throw new UnreadableDataError('The data file is not a JSON object.')
  let doc = raw as Record<string, unknown>
  const version = doc.version
  if (typeof version === 'number' && Number.isInteger(version) && version > CURRENT_VERSION) {
    throw new NewerVersionError(version)
  }
  if (version !== CURRENT_VERSION && version !== 1) {
    throw new UnreadableDataError(`Unsupported data version: ${JSON.stringify(version)}.`)
  }
  for (const key of ['tasks', 'categories', 'archive'] as const) {
    if (!Array.isArray(doc[key])) throw new UnreadableDataError(`The data file has no "${key}" list.`)
  }
  if (version === 1) doc = upgradeFromV1(doc)

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
      settings: SettingsSchema.parse(objectOrEmpty(doc.settings)),
      sounds: parseSounds(doc.sounds),
      alerts: AlertsSchema.parse(objectOrEmpty(doc.alerts)),
      imports: parseImports(doc.imports),
      meta: MetaSchema.parse(objectOrEmpty(doc.meta)),
    },
    quarantined,
    upgradedFrom: version === CURRENT_VERSION ? null : version,
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

    // Before an upgrade rewrites the file in the new format, keep the original exactly as it was.
    // `.bak` is refreshed on every launch, so it can't serve as this copy.
    if (parsed?.upgradedFrom) {
      const copy = path.join(directory, PRE_UPGRADE_COPY(parsed.upgradedFrom))
      await fs.copyFile(backup, copy, fs.constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    }

    const store = new Store(directory, parsed?.data ?? emptyAppData())
    // Persist any repairs or upgrade (or create the file) so what is on disk matches what is in memory.
    if (!parsed || parsed.upgradedFrom || parsed.quarantined.length > 0 || issues.length > 0)
      await store.replace(store.data)
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
  /** Copies the current data file to the backup (after any queued writes). */
  async refreshBackup(): Promise<void> {
    await this.flush()
    await fs.copyFile(this.filePath, `${this.filePath}.bak`)
  }

  flush(): Promise<void> {
    return this.writeQueue
  }

  private async write(data: AppData) {
    const target = this.filePath
    const temp = `${target}.tmp`
    // Flush to disk before the rename so a power cut can't leave an empty data file.
    const handle = await fs.open(temp, 'w')
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(temp, target)
  }
}
