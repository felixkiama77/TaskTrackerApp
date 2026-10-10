import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importSuggestionsFile } from '../../src/domain/suggestions'
import { emptyAppData } from '../../src/domain/types'

/**
 * scripts/write-suggestions.mjs is what the scheduled tasks use to build and write their files. Its
 * checks are a copy of the app's rules, so these tests run it for real and feed the result to the
 * app's own import code.
 */
const run = promisify(execFile)
const SCRIPT = path.resolve('scripts/write-suggestions.mjs')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'tasktracker-write-suggestions-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const good = [
  {
    system: 'canvas',
    externalId: 'course-1/assignment-2',
    title: 'Group Assignment 1',
    notes: 'Team assignment, upload on Canvas.',
    link: 'https://canvas.uw.edu/courses/1/assignments/2',
    dueDate: '2026-10-12',
    dueTime: '23:59',
    priority: 'high',
    categories: ['School'],
    reminders: [720, 360],
  },
  {
    system: 'study-group',
    externalId: 'tcss380/2026-10-12',
    title: 'Plan a study group',
    dueDate: '2026-10-13',
  },
]

async function cli(input: unknown, ...args: string[]) {
  const file = path.join(dir, 'input.json')
  await fs.writeFile(file, JSON.stringify(input), 'utf8')
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args, file], {
      env: { ...process.env, TZ: 'America/Los_Angeles' },
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string }
    return { code: e.code, stdout: e.stdout, stderr: e.stderr }
  }
}

const withSchool = () => {
  const data = emptyAppData()
  data.categories = [{ id: 'school', name: 'School', createdAt: '2026-10-01T00:00:00.000Z' }]
  return data
}

describe('write-suggestions script', () => {
  it('prints a complete file in a dry run, with a timestamp Task Tracker accepts', async () => {
    const { code, stdout } = await cli(good, '--origin', 'Weekly coursework sync')
    expect(code).toBe(0)
    expect(stdout).toMatch(/^DRY RUN: 2 suggestion\(s\) checked; nothing written\./)
    const text = stdout.slice(stdout.indexOf('{'))
    const file = JSON.parse(text) as { generatedAt: string }
    expect(file.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/)
    expect(Math.abs(Date.parse(file.generatedAt) - Date.now())).toBeLessThan(60_000)

    const { report } = importSuggestionsFile(
      withSchool(),
      { name: 'weekly.json', hash: 'h', text },
      {
        now: Date.now(),
        newId: () => Math.random().toString(36),
      },
    )
    expect(report).toMatchObject({ error: null, created: 2, notes: [] })
    expect(await fs.readdir(dir)).toEqual(['input.json'])
  })

  it('writes the file with --out and leaves no temporary file behind', async () => {
    const out = path.join(dir, 'weekly-coursework.json')
    const { code, stdout } = await cli(good, '--origin', 'Weekly coursework sync', '--out', out)
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Wrote 2 suggestion\(s\) to /)
    expect((await fs.readdir(dir)).sort()).toEqual(['input.json', 'weekly-coursework.json'])
    const written = JSON.parse(await fs.readFile(out, 'utf8')) as { suggestions: unknown[]; origin: string }
    expect(written.origin).toBe('Weekly coursework sync')
    expect(written.suggestions).toEqual(good)
  })

  it('lists every problem and writes nothing when anything is wrong', async () => {
    const out = path.join(dir, 'weekly-coursework.json')
    await fs.writeFile(out, 'previous file', 'utf8')
    const bad = [
      { ...good[0], dueDate: '2026-02-30' },
      { ...good[0], externalId: 'x', link: 'http://insecure.example.com' },
      { ...good[0], externalId: 'y', reminders: [45] },
      { ...good[0], externalId: 'z', system: 'Canvas LMS', dueTime: '24:00' },
      good[1],
      good[1],
    ]
    const { code, stderr } = await cli(bad, '--origin', 'Weekly coursework sync', '--out', out)
    expect(code).toBe(1)
    expect(stderr).toContain('Nothing was written.')
    for (const expected of [
      'suggestion 1 (“Group Assignment 1”): dueDate must be a real date',
      'suggestion 2 (“Group Assignment 1”): link must start with https://',
      'suggestion 3 (“Group Assignment 1”): reminders must be distinct values',
      'suggestion 4 (“Group Assignment 1”): system must be lowercase',
      'suggestion 4 (“Group Assignment 1”): dueTime must be HH:MM',
      'suggestion 6 (“Plan a study group”): the id study-group:tcss380/2026-10-12 is used twice',
    ])
      expect(stderr).toContain(expected)
    expect(await fs.readFile(out, 'utf8')).toBe('previous file')
  })

  it('requires an origin', async () => {
    const { code, stderr } = await cli(good)
    expect(code).toBe(1)
    expect(stderr).toContain('--origin is missing')
  })
})
