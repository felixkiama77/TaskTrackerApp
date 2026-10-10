import { z } from 'zod'
import {
  IsoTimestampSchema,
  LinkSchema,
  LocalDateSchema,
  LocalTimeSchema,
  NotesSchema,
  PrioritySchema,
  ReminderLeadSchema,
} from './schemas'
import {
  MAX_TASKS,
  REMINDER_PRESETS,
  type AppData,
  type ImportedValues,
  type ImportReport,
  type TaskDefinition,
} from './types'

/**
 * Suggested-task files (see docs/DECISIONS.md, "School automation"). A Claude Code routine writes one
 * of these to a synced folder; the app reads it and adds or updates tasks.
 *
 * Rules, all enforced here:
 * - Every suggestion has a stable id ("system" + "externalId"), so importing the same file again
 *   changes nothing.
 * - A task you deleted is never added back.
 * - A field you edited in the app is never overwritten; the change at the source is noted instead.
 * - Completed or skipped tasks are left alone.
 * - Nothing is ever deleted, and an item missing from a file means nothing.
 */
export const SUGGESTIONS_FORMAT = 'task-tracker-suggestions'
export const MAX_SUGGESTIONS_FILE_BYTES = 1_000_000
export const MAX_SUGGESTIONS_PER_FILE = 300
/** Reports kept for Settings, newest first. */
export const MAX_IMPORT_REPORTS = 20
const MAX_REPORT_NOTES = 50

export const SuggestionSchema = z.object({
  system: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'system must be lowercase letters, digits or dashes'),
  externalId: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(200),
  notes: NotesSchema.default(''),
  link: LinkSchema.nullable().default(null),
  dueDate: LocalDateSchema,
  dueTime: LocalTimeSchema.nullable().default(null),
  priority: PrioritySchema.default('medium'),
  /** Category names; matched to existing categories ignoring case. Unknown names are left out. */
  categories: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  reminders: z.array(ReminderLeadSchema).max(REMINDER_PRESETS.length).default([]),
})
export type Suggestion = z.infer<typeof SuggestionSchema>

const FileSchema = z.object({
  format: z.literal(SUGGESTIONS_FORMAT),
  version: z.literal(1),
  /** Which routine wrote the file, shown in reports, e.g. "Weekly coursework sync". */
  origin: z.string().trim().min(1).max(100),
  generatedAt: IsoTimestampSchema,
  suggestions: z.array(z.unknown()).max(MAX_SUGGESTIONS_PER_FILE),
})

export interface SuggestionsFile {
  name: string
  /** Content hash; the file is not processed again until it changes. */
  hash: string
  text: string
}

export interface ImportContext {
  now: number
  newId: () => string
}

const keyOf = (system: string, externalId: string) => `${system}:${externalId}`
export const sourceKey = (task: TaskDefinition) =>
  task.source ? keyOf(task.source.system, task.source.externalId) : null

type Field = keyof ImportedValues

const FIELD_LABEL: Record<Field, string> = {
  title: 'name',
  notes: 'notes',
  link: 'link',
  dueDate: 'due date',
  dueTime: 'due time',
  priority: 'priority',
  categoryIds: 'categories',
  reminders: 'reminders',
}

const FIELDS = Object.keys(FIELD_LABEL) as Field[]

function sameValue(a: ImportedValues[Field], b: ImportedValues[Field]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const sa = [...a].map(String).sort()
    const sb = [...b].map(String).sort()
    return sa.length === sb.length && sa.every((v, i) => v === sb[i])
  }
  return a === b
}

function currentValues(task: TaskDefinition): ImportedValues {
  return {
    title: task.title,
    notes: task.notes,
    link: task.link,
    dueDate: task.startDate,
    dueTime: task.dueTime,
    priority: task.priority,
    categoryIds: [...task.categoryIds],
    reminders: [...task.reminders],
  }
}

function setValue(task: TaskDefinition, field: Field, value: ImportedValues[Field]) {
  switch (field) {
    case 'dueDate':
      task.startDate = value as string
      break
    case 'categoryIds':
    case 'reminders':
      ;(task[field] as unknown[]) = [...(value as unknown[])]
      break
    default:
      ;(task as unknown as Record<string, unknown>)[field] = value
  }
}

/** Reads one suggestions file and applies it. Always returns a report; on error nothing else changes. */
export function importSuggestionsFile(
  data: AppData,
  file: SuggestionsFile,
  ctx: ImportContext,
): { data: AppData; report: ImportReport } {
  const nowIso = new Date(ctx.now).toISOString()
  const report: ImportReport = {
    file: file.name.slice(0, 260),
    origin: '',
    at: nowIso,
    error: null,
    created: 0,
    updated: 0,
    unchanged: 0,
    notes: [],
  }
  const next = structuredClone(data)
  const finish = () => {
    next.imports.files[file.name] = file.hash
    next.imports.reports = [report, ...next.imports.reports].slice(0, MAX_IMPORT_REPORTS)
    report.notes = report.notes.slice(0, MAX_REPORT_NOTES)
    return { data: next, report }
  }

  let raw: unknown
  try {
    raw = JSON.parse(file.text)
  } catch {
    report.error = 'The file isn’t valid JSON, so nothing was imported.'
    return finish()
  }
  const parsedFile = FileSchema.safeParse(raw)
  if (!parsedFile.success) {
    const issue = parsedFile.error.issues[0]
    report.error = `The file isn’t a Task Tracker suggestions file (${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'invalid'}), so nothing was imported.`
    return finish()
  }
  report.origin = parsedFile.data.origin

  const categoryByName = new Map(next.categories.map((c) => [c.name.trim().toLocaleLowerCase(), c.id]))
  const missingCategories = new Set<string>()
  const seenInFile = new Set<string>()
  let deletedBefore = 0

  parsedFile.data.suggestions.forEach((item, index) => {
    const parsed = SuggestionSchema.safeParse(item)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      report.notes.push(
        `Suggestion ${index + 1} was skipped because it isn’t valid (${issue?.path.join('.') || 'item'}: ${issue?.message ?? 'invalid'}).`,
      )
      return
    }
    const s = parsed.data
    const key = keyOf(s.system, s.externalId)
    if (seenInFile.has(key)) {
      report.notes.push(`“${s.title}” appears twice in the file; only the first was used.`)
      return
    }
    seenInFile.add(key)

    const categoryIds: string[] = []
    for (const name of s.categories) {
      const id = categoryByName.get(name.toLocaleLowerCase())
      if (id === undefined) missingCategories.add(name)
      else if (!categoryIds.includes(id)) categoryIds.push(id)
    }
    const incoming: ImportedValues = {
      title: s.title,
      notes: s.notes.trim(),
      link: s.link === null || s.link === '' ? null : s.link,
      dueDate: s.dueDate,
      dueTime: s.dueTime,
      priority: s.priority,
      categoryIds,
      reminders: [...new Set(s.reminders)].sort((a, b) => a - b),
    }

    const task = next.tasks.find((t) => sourceKey(t) === key)
    if (!task) {
      if (next.imports.seen[key] !== undefined) {
        deletedBefore++
        report.unchanged++
        return
      }
      if (next.tasks.length >= MAX_TASKS) {
        report.notes.push(`“${s.title}” wasn’t added because the task limit has been reached.`)
        return
      }
      next.tasks.push({
        id: ctx.newId(),
        title: incoming.title,
        priority: incoming.priority,
        notes: incoming.notes,
        link: incoming.link,
        categoryIds: [...incoming.categoryIds],
        startDate: incoming.dueDate,
        dueTime: incoming.dueTime,
        recurrence: { kind: 'once' },
        end: { kind: 'never' },
        endBefore: null,
        reminders: [...incoming.reminders],
        completed: {},
        exceptions: {},
        source: {
          system: s.system,
          externalId: s.externalId,
          origin: parsedFile.data.origin,
          importedAt: nowIso,
          imported: structuredClone(incoming),
        },
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      next.imports.seen[key] = nowIso
      report.created++
      return
    }

    next.imports.seen[key] ??= nowIso
    const source = task.source!
    // Done, skipped, or turned into a repeating task by you: leave it exactly as it is.
    const settled =
      task.recurrence.kind !== 'once' ||
      task.completed[task.startDate] !== undefined ||
      task.exceptions[task.startDate] !== undefined
    if (settled) {
      report.unchanged++
      return
    }

    const current = currentValues(task)
    const changed: Field[] = []
    const kept: Field[] = []
    for (const field of FIELDS) {
      if (sameValue(incoming[field], source.imported[field])) continue // No change at the source.
      if (sameValue(incoming[field], current[field])) continue // Already matches.
      if (sameValue(current[field], source.imported[field])) {
        setValue(task, field, incoming[field])
        changed.push(field)
      } else {
        kept.push(field) // You edited it; your version stays.
      }
    }
    if (kept.length > 0) {
      report.notes.push(
        `“${task.title}”: kept your ${listJoin(kept.map((f) => FIELD_LABEL[f]))}; the source changed ${kept.length === 1 ? 'it' : 'them'}.`,
      )
    }
    const sourceMoved = FIELDS.some((f) => !sameValue(incoming[f], source.imported[f]))
    if (sourceMoved) {
      source.imported = structuredClone(incoming)
      source.importedAt = nowIso
      source.origin = parsedFile.data.origin
    }
    if (changed.length > 0) {
      task.updatedAt = nowIso
      report.updated++
    } else {
      report.unchanged++
    }
  })

  if (deletedBefore > 0) {
    report.notes.push(
      deletedBefore === 1
        ? '1 suggestion for a task you deleted was not added again.'
        : `${deletedBefore} suggestions for tasks you deleted were not added again.`,
    )
  }
  if (missingCategories.size > 0) {
    report.notes.push(
      `No category named ${listJoin([...missingCategories].map((n) => `“${n}”`))}, so ${missingCategories.size === 1 ? 'it was' : 'they were'} left off. Create ${missingCategories.size === 1 ? 'it' : 'them'} in Categories to use ${missingCategories.size === 1 ? 'it' : 'them'} next time.`,
    )
  }
  return finish()
}

/** Forgets processed-file hashes for files no longer in the folder, so a re-added file is read again. */
export function forgetMissingFiles(data: AppData, present: string[]): AppData {
  const keep = new Set(present)
  const files = Object.fromEntries(Object.entries(data.imports.files).filter(([name]) => keep.has(name)))
  if (Object.keys(files).length === Object.keys(data.imports.files).length) return data
  return { ...data, imports: { ...data.imports, files } }
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
