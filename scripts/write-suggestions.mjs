// Builds, checks and safely writes a suggested-tasks file for Task Tracker (format: docs/SUGGESTED_TASKS.md).
// Used by the school scheduled tasks so the fiddly parts (timestamp, checks, safe writing) are the
// same every run instead of being improvised.
//
//   node scripts/write-suggestions.mjs --origin "Weekly coursework sync" <suggestions.json>
//       Checks the suggestions and prints the complete file. Writes nothing (dry run).
//   node scripts/write-suggestions.mjs --origin "..." --out "G:\My Drive\Task Tracker Inbox\x.json" <suggestions.json>
//       Also writes the file: a temporary file first, then renamed over the real one.
//
// <suggestions.json> holds a JSON array of suggestions (or an object with a "suggestions" array).
// If anything is wrong, every problem is listed, nothing is written, and the exit code is 1.
// The checks mirror src/domain/suggestions.ts; Task Tracker still checks everything itself.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const REMINDER_PRESETS = [0, 5, 15, 30, 60, 120, 360, 720, 1440, 2880]
const MAX_SUGGESTIONS = 300
const MAX_FILE_BYTES = 1_000_000

const pad = (n) => String(n).padStart(2, '0')

/** Local time with its UTC offset, e.g. "2026-10-11T17:07:00-07:00". */
export function formatLocalIso(date) {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

const isTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

function isHttpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

const isText = (value, min, max) =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max

/** Returns the problems with one suggestion (empty when it's fine). */
export function checkSuggestion(s) {
  const problems = []
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['is not an object']
  if (typeof s.system !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(s.system))
    problems.push('system must be lowercase letters, digits or dashes')
  if (!isText(s.externalId, 1, 300)) problems.push('externalId is missing or too long')
  if (!isText(s.title, 1, 200)) problems.push('title is missing or longer than 200 characters')
  if (!isCalendarDate(s.dueDate)) problems.push('dueDate must be a real date as YYYY-MM-DD')
  if (s.dueTime !== undefined && s.dueTime !== null && !isTime(s.dueTime))
    problems.push('dueTime must be HH:MM (24-hour) or null')
  if (s.notes !== undefined && !isText(s.notes, 0, 1000))
    problems.push('notes must be text under 1,000 characters')
  if (s.link !== undefined && s.link !== null && !(typeof s.link === 'string' && isHttpsUrl(s.link.trim())))
    problems.push('link must start with https://')
  if (s.priority !== undefined && !['low', 'medium', 'high'].includes(s.priority))
    problems.push('priority must be low, medium or high')
  if (s.categories !== undefined) {
    if (
      !Array.isArray(s.categories) ||
      s.categories.length > 10 ||
      !s.categories.every((c) => isText(c, 1, 40))
    )
      problems.push('categories must be up to 10 names of 1–40 characters')
  }
  if (s.reminders !== undefined) {
    if (
      !Array.isArray(s.reminders) ||
      !s.reminders.every((r) => REMINDER_PRESETS.includes(r)) ||
      new Set(s.reminders).size !== s.reminders.length
    )
      problems.push(`reminders must be distinct values from ${REMINDER_PRESETS.join(', ')}`)
  }
  return problems
}

/** Wraps checked suggestions in the file format. `problems` lists everything wrong, by position and title. */
export function buildSuggestionsFile(input, origin, now = new Date()) {
  const suggestions = Array.isArray(input) ? input : input?.suggestions
  const problems = []
  if (!isText(origin, 1, 100)) problems.push('--origin is missing or longer than 100 characters')
  if (!Array.isArray(suggestions)) {
    problems.push('the input must be a JSON array of suggestions')
    return { file: null, problems }
  }
  if (suggestions.length > MAX_SUGGESTIONS) problems.push(`more than ${MAX_SUGGESTIONS} suggestions`)
  const ids = new Set()
  suggestions.forEach((s, i) => {
    const label = `suggestion ${i + 1}${s && typeof s.title === 'string' ? ` (“${s.title}”)` : ''}`
    for (const problem of checkSuggestion(s)) problems.push(`${label}: ${problem}`)
    const id = s && `${s.system}:${s.externalId}`
    if (id && ids.has(id)) problems.push(`${label}: the id ${id} is used twice`)
    ids.add(id)
  })
  const file = {
    format: 'task-tracker-suggestions',
    version: 1,
    origin: typeof origin === 'string' ? origin.trim() : origin,
    generatedAt: formatLocalIso(now),
    suggestions,
  }
  if (Buffer.byteLength(JSON.stringify(file, null, 2)) > MAX_FILE_BYTES)
    problems.push('the file would be over 1 MB')
  return { file, problems }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Writes a temporary file next to the target, then renames it over the target (retrying briefly if locked). */
export async function writeAtomically(target, text) {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp`)
  await fs.writeFile(temp, text, 'utf8')
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temp, target)
      return
    } catch (error) {
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
        await fs.rm(temp, { force: true })
        throw error
      }
      await sleep(100 * (attempt + 1))
    }
  }
}

function parseArgs(argv) {
  const args = { origin: null, out: null, input: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--origin') args.origin = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
    else args.input = argv[i]
  }
  return args
}

async function main() {
  const { origin, out, input } = parseArgs(process.argv.slice(2))
  if (!input) {
    console.error(
      'Usage: node scripts/write-suggestions.mjs --origin "<name>" [--out <file>] <suggestions.json>',
    )
    process.exit(2)
  }
  let parsed
  try {
    parsed = JSON.parse(await fs.readFile(input, 'utf8'))
  } catch (error) {
    console.error(`Couldn't read ${input} as JSON: ${error.message}`)
    process.exit(1)
  }
  const { file, problems } = buildSuggestionsFile(parsed, origin)
  if (problems.length > 0) {
    console.error(`Nothing was written. Fix these ${problems.length} problem(s):`)
    for (const problem of problems) console.error(`- ${problem}`)
    process.exit(1)
  }
  const text = `${JSON.stringify(file, null, 2)}\n`
  if (out) {
    await writeAtomically(out, text)
    console.log(`Wrote ${file.suggestions.length} suggestion(s) to ${out} (generatedAt ${file.generatedAt}).`)
  } else {
    console.log(`DRY RUN: ${file.suggestions.length} suggestion(s) checked; nothing written.`)
    console.log(text)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Failed: ${error.message}`)
    process.exit(1)
  })
}
