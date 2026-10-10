import { z } from 'zod'
import { isValidLocalDate, isValidLocalTime } from './dates'
import { EFFECT_CUES, NOTIFICATION_CUES, STORED_FILE_PATTERN } from './sounds'
import { DEFAULT_SETTINGS, MAX_NOTES_LENGTH, REMINDER_PRESETS } from './types'

/**
 * Validation shared by the renderer (form feedback), the IPC boundary (untrusted payloads) and the
 * persistence layer (untrusted files). Messages are written for end users.
 */

const unique = <T>(values: T[]) => new Set(values).size === values.length

export const IdSchema = z.string().min(1).max(100)
export const LocalDateSchema = z.string().refine(isValidLocalDate, 'Enter a valid date.')
export const LocalTimeSchema = z.string().refine(isValidLocalTime, 'Enter a valid time.')
export const IsoTimestampSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid timestamp.')
export const PrioritySchema = z.enum(['low', 'medium', 'high'], { error: 'Choose a priority.' })

/** Optional web link. Only https is accepted, because the app opens it in the browser. */
export const LinkSchema = z
  .string()
  .trim()
  .max(2000, 'Keep the link under 2,000 characters.')
  .refine(isHttpsUrl, 'Enter a full link starting with https://')

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export const NotesSchema = z
  .string()
  .max(MAX_NOTES_LENGTH, `Keep notes under ${MAX_NOTES_LENGTH.toLocaleString('en-US')} characters.`)
export const WeekdaySchema = z.literal([0, 1, 2, 3, 4, 5, 6])

export const RecurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once') }),
  z.object({ kind: z.literal('daily') }),
  z.object({
    kind: z.literal('weekly'),
    weekdays: z
      .array(WeekdaySchema)
      .min(1, 'Choose at least one day.')
      .refine(unique, 'Each day can only be chosen once.'),
  }),
  z.object({ kind: z.literal('monthly'), dayOfMonth: z.number().int().min(1).max(31) }),
])

export const MAX_REPEAT_COUNT = 1000

export const RecurrenceEndSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('never') }),
  z.object({
    kind: z.literal('count'),
    count: z
      .number({ error: 'Enter how many times the task occurs.' })
      .int('Enter a whole number.')
      .min(1, 'A task occurs at least once.')
      .max(MAX_REPEAT_COUNT, `Enter ${MAX_REPEAT_COUNT} or fewer.`),
  }),
])

export const ReminderLeadSchema = z
  .number()
  .int()
  .refine((n) => (REMINDER_PRESETS as readonly number[]).includes(n), 'Unsupported reminder time.')

/** What the user enters when creating or editing a task. */
export const TaskInputSchema = z.object({
  title: z.string().trim().min(1, 'Enter a task name.').max(200, 'Keep the name under 200 characters.'),
  priority: PrioritySchema,
  notes: NotesSchema.default(''),
  link: LinkSchema.nullable().default(null),
  dueDate: z.string({ error: 'Choose a due date.' }).min(1, 'Choose a due date.').pipe(LocalDateSchema),
  dueTime: LocalTimeSchema.nullable(),
  recurrence: RecurrenceSchema,
  end: RecurrenceEndSchema,
  categoryIds: z.array(IdSchema).max(100).refine(unique, 'A category can only be assigned once.'),
  reminders: z.array(ReminderLeadSchema).max(REMINDER_PRESETS.length).refine(unique, 'Duplicate reminder.'),
})
export type TaskInput = z.infer<typeof TaskInputSchema>

export const CategoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a category name.')
  .max(40, 'Keep category names under 40 characters.')

const VolumeSchema = z.number().min(0).max(1)

export const SettingsSchema = z.object({
  remindersEnabled: z.boolean().catch(DEFAULT_SETTINGS.remindersEnabled),
  playSound: z.boolean().catch(DEFAULT_SETTINGS.playSound),
  notificationVolume: VolumeSchema.catch(DEFAULT_SETTINGS.notificationVolume),
  soundEffects: z.boolean().catch(DEFAULT_SETTINGS.soundEffects),
  effectsVolume: VolumeSchema.catch(DEFAULT_SETTINGS.effectsVolume),
  music: z.boolean().catch(DEFAULT_SETTINGS.music),
  musicVolume: VolumeSchema.catch(DEFAULT_SETTINGS.musicVolume),
  musicShuffle: z.boolean().catch(DEFAULT_SETTINGS.musicShuffle),
  dateOnlyReminderTime: LocalTimeSchema.catch(DEFAULT_SETTINGS.dateOnlyReminderTime),
  closeBehavior: z.enum(['tray', 'quit']).catch(DEFAULT_SETTINGS.closeBehavior),
  launchAtLogin: z.boolean().catch(DEFAULT_SETTINGS.launchAtLogin),
  weekStart: z.union([z.literal('locale'), WeekdaySchema]).catch(DEFAULT_SETTINGS.weekStart),
  showCompletedInCalendar: z.boolean().catch(DEFAULT_SETTINGS.showCompletedInCalendar),
})

export const SettingsPatchSchema = z
  .object({
    remindersEnabled: z.boolean(),
    playSound: z.boolean(),
    notificationVolume: VolumeSchema,
    soundEffects: z.boolean(),
    effectsVolume: VolumeSchema,
    music: z.boolean(),
    musicVolume: VolumeSchema,
    musicShuffle: z.boolean(),
    dateOnlyReminderTime: LocalTimeSchema,
    closeBehavior: z.enum(['tray', 'quit']),
    launchAtLogin: z.boolean(),
    weekStart: z.union([z.literal('locale'), WeekdaySchema]),
    showCompletedInCalendar: z.boolean(),
  })
  .partial()
  .strict()

const UserSoundSchema = z.object({
  file: z.string().regex(STORED_FILE_PATTERN),
  originalName: z.string().min(1).max(260),
  addedAt: IsoTimestampSchema,
})

export const UserSoundEntrySchema = UserSoundSchema
export const UserTrackSchema = UserSoundSchema.extend({
  id: IdSchema,
  title: z.string().min(1).max(260),
})

/** Which sound slot a request refers to (from the renderer, so validated in the main process). */
export const SoundSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('effect'), cue: z.enum(EFFECT_CUES) }),
  z.object({ kind: z.literal('notification'), cue: z.enum(NOTIFICATION_CUES) }),
  z.object({ kind: z.literal('music') }),
])

export const CategorySchema = z.object({
  id: IdSchema,
  name: CategoryNameSchema,
  createdAt: IsoTimestampSchema,
})

const ImportedValuesSchema = z.object({
  title: z.string().max(200),
  notes: z.string().max(MAX_NOTES_LENGTH),
  link: z.string().max(2000).nullable(),
  dueDate: LocalDateSchema,
  dueTime: LocalTimeSchema.nullable(),
  priority: PrioritySchema,
  categoryIds: z.array(IdSchema),
  reminders: z.array(z.number().int()),
})

export const TaskSourceSchema = z.object({
  system: z.string().min(1).max(40),
  externalId: z.string().min(1).max(300),
  origin: z.string().max(100),
  importedAt: IsoTimestampSchema,
  imported: ImportedValuesSchema,
})

export const TaskDefinitionSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1).max(200),
  priority: PrioritySchema,
  notes: NotesSchema,
  link: LinkSchema.nullable(),
  categoryIds: z.array(IdSchema),
  startDate: LocalDateSchema,
  dueTime: LocalTimeSchema.nullable(),
  recurrence: RecurrenceSchema,
  end: RecurrenceEndSchema,
  endBefore: LocalDateSchema.nullable(),
  reminders: z.array(ReminderLeadSchema),
  completed: z.record(LocalDateSchema, IsoTimestampSchema),
  exceptions: z.record(LocalDateSchema, z.enum(['skipped', 'detached'])),
  source: TaskSourceSchema.nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
})

export const ArchiveRecordSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  occurrenceKey: LocalDateSchema,
  title: z.string().min(1).max(200),
  priority: PrioritySchema,
  categoryIds: z.array(IdSchema),
  categoryNames: z.array(z.string()),
  dueDate: LocalDateSchema,
  dueTime: LocalTimeSchema.nullable(),
  recurrence: RecurrenceSchema,
  end: RecurrenceEndSchema,
  occurrenceNumber: z.number().int().min(1),
  reminders: z.array(z.number().int()),
  completedAt: IsoTimestampSchema,
  classification: z.enum(['early', 'on-time', 'overdue', 'unknown']),
})

const UpdateScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('series') }),
  z.object({ kind: z.literal('occurrence'), key: LocalDateSchema }),
  z.object({ kind: z.literal('future'), key: LocalDateSchema }),
])

const DeleteScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('series') }),
  z.object({ kind: z.literal('occurrence'), key: LocalDateSchema }),
])

/** Every change the renderer can request. Validated in the main process before it is applied. */
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task/create'), input: TaskInputSchema }),
  z.object({
    type: z.literal('task/update'),
    taskId: IdSchema,
    input: TaskInputSchema,
    scope: UpdateScopeSchema,
  }),
  z.object({ type: z.literal('task/delete'), taskId: IdSchema, scope: DeleteScopeSchema }),
  z.object({ type: z.literal('task/skipMissed'), taskId: IdSchema }),
  z.object({ type: z.literal('occurrence/complete'), taskId: IdSchema, key: LocalDateSchema }),
  z.object({ type: z.literal('occurrence/uncomplete'), taskId: IdSchema, key: LocalDateSchema }),
  z.object({ type: z.literal('occurrence/skip'), taskId: IdSchema, key: LocalDateSchema }),
  z.object({ type: z.literal('occurrence/restore'), taskId: IdSchema, key: LocalDateSchema }),
  z.object({ type: z.literal('category/create'), name: CategoryNameSchema }),
  z.object({ type: z.literal('category/rename'), categoryId: IdSchema, name: CategoryNameSchema }),
  z.object({ type: z.literal('category/delete'), categoryId: IdSchema }),
  z.object({ type: z.literal('settings/update'), patch: SettingsPatchSchema }),
])
export type Command = z.infer<typeof CommandSchema>
/** A command as sent to the main process; optional fields (e.g. a task's notes) get their defaults there. */
export type CommandInput = z.input<typeof CommandSchema>
export type UpdateScope = z.infer<typeof UpdateScopeSchema>
export type DeleteScope = z.infer<typeof DeleteScopeSchema>

/** Maps Zod issues to the first message per top-level field, for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path.map(String).join('.') || 'form'
    result[field] ??= issue.message
  }
  return result
}
