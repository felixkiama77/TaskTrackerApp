import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  forgetMissingFiles,
  importSuggestionsFile,
  MAX_IMPORT_REPORTS,
  MAX_SUGGESTIONS_FILE_BYTES,
  type SuggestionsFile,
} from '../src/domain/suggestions'
import type { AppData, ImportReport } from '../src/domain/types'
import type { ImportStatus } from '../src/shared/api'
import type { Store } from './store'

/**
 * Reads suggested-task files from the folder chosen in Settings. Only `.json` files directly in that
 * folder are read (never subfolders or links), and a file is processed again only when its content
 * changes. The data file is written only when something actually changed.
 *
 * This only reads files that something else put there; it never contacts Canvas, Outlook or any
 * other service.
 */
export const MAX_FILES_PER_CHECK = 50

export interface ImporterDeps {
  store: Store
  now: () => number
  newId: () => string
  /** Called after imported changes were saved. */
  onChanged(previous: AppData, next: AppData): void
  /** Called after every check with the new status and the reports for files that changed. */
  onChecked(status: ImportStatus, reports: ImportReport[]): void
}

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex')
const TOO_LARGE = 'too-large:'

export class SuggestionImporter {
  private running: Promise<ImportReport[]> | null = null
  private timer: NodeJS.Timeout | null = null
  private lastCheckedAt: string | null = null
  private folderError: string | null = null

  constructor(private readonly deps: ImporterDeps) {}

  start(intervalMs = 5 * 60_000) {
    void this.check()
    this.timer = setInterval(() => void this.check(), intervalMs)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): ImportStatus {
    return {
      folder: this.deps.store.get().imports.folder,
      lastCheckedAt: this.lastCheckedAt,
      folderError: this.folderError,
    }
  }

  /** Checks the folder now. Overlapping calls share one check. */
  check(): Promise<ImportReport[]> {
    this.running ??= this.run()
      .catch((error: unknown): ImportReport[] => {
        console.error('[importer] Check failed:', error)
        this.folderError = 'The last check failed. It will be tried again in a few minutes.'
        return []
      })
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  private async run(): Promise<ImportReport[]> {
    const folder = this.deps.store.get().imports.folder
    if (!folder) {
      this.folderError = null
      return []
    }

    // Read everything first; the stored data is only touched afterwards, in one synchronous step,
    // so a change made in the window meanwhile can't be lost.
    let names: string[] | null = null
    let folderError: string | null = null
    const files: SuggestionsFile[] = []
    try {
      const entries = await fs.readdir(folder, { withFileTypes: true })
      names = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json') && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort()
        .slice(0, MAX_FILES_PER_CHECK)
    } catch (error) {
      folderError =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'The folder can’t be found. If it’s in Google Drive, check that Google Drive is running.'
          : 'The folder couldn’t be opened.'
    }

    const known = this.deps.store.get().imports.files
    for (const name of names ?? []) {
      const full = path.join(folder, name)
      try {
        const info = await fs.stat(full)
        if (info.size > MAX_SUGGESTIONS_FILE_BYTES) {
          const marker = `${TOO_LARGE}${info.size}:${info.mtimeMs}`
          if (known[name] !== marker) files.push({ name, hash: marker, text: '' })
          continue
        }
        const text = await fs.readFile(full, 'utf8')
        const hash = hashOf(text)
        if (known[name] !== hash) files.push({ name, hash, text })
      } catch (error) {
        console.warn(`[importer] Couldn't read ${name}:`, (error as Error).message)
      }
    }

    const previous = this.deps.store.get()
    // The folder was changed while this check was reading; the next check handles the new one.
    if (previous.imports.folder !== folder) return []
    let next: AppData = names ? forgetMissingFiles(previous, names) : previous
    const reports: ImportReport[] = []
    for (const file of files) {
      const result = file.hash.startsWith(TOO_LARGE)
        ? tooLarge(next, file, this.deps.now())
        : importSuggestionsFile(next, file, { now: this.deps.now(), newId: this.deps.newId })
      next = result.data
      reports.push(result.report)
    }

    if (next !== previous) {
      await this.deps.store.replace(next)
      this.deps.onChanged(previous, next)
    }
    this.lastCheckedAt = new Date(this.deps.now()).toISOString()
    this.folderError = folderError
    this.deps.onChecked(this.status(), reports)
    return reports
  }
}

function tooLarge(
  data: AppData,
  file: SuggestionsFile,
  now: number,
): { data: AppData; report: ImportReport } {
  const report: ImportReport = {
    file: file.name,
    origin: '',
    at: new Date(now).toISOString(),
    error: 'The file is larger than 1 MB, so it wasn’t read.',
    created: 0,
    updated: 0,
    unchanged: 0,
    notes: [],
  }
  return {
    data: {
      ...data,
      imports: {
        ...data.imports,
        files: { ...data.imports.files, [file.name]: file.hash },
        reports: [report, ...data.imports.reports].slice(0, MAX_IMPORT_REPORTS),
      },
    },
    report,
  }
}
