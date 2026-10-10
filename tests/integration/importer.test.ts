import { mkdtempSync, rmSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SuggestionImporter } from '../../electron/importer'
import { Store } from '../../electron/store'
import type { ImportReport } from '../../src/domain/types'
import type { ImportStatus } from '../../src/shared/api'

let root: string
let inbox: string
let store: Store
let changes: number
let checks: { status: ImportStatus; reports: ImportReport[] }[]

const suggestions = (items: object[]) =>
  JSON.stringify({
    format: 'task-tracker-suggestions',
    version: 1,
    origin: 'Daily school email triage',
    generatedAt: '2026-10-12T16:07:00.000Z',
    suggestions: items,
  })

const item = (externalId: string, title: string) => ({
  system: 'outlook',
  externalId,
  title,
  dueDate: '2026-10-12',
  categories: ['School'],
})

function makeImporter() {
  let n = 0
  return new SuggestionImporter({
    store,
    now: () => Date.parse('2026-10-12T16:10:00.000Z'),
    newId: () => `id-${++n}`,
    onChanged: () => changes++,
    onChecked: (status, reports) => checks.push({ status, reports }),
  })
}

async function useFolder(folder: string | null) {
  const data = store.get()
  await store.replace({ ...data, imports: { ...data.imports, folder, files: {} } })
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'tasktracker-importer-'))
  inbox = path.join(root, 'Task Tracker Inbox')
  await fs.mkdir(inbox)
  store = (await Store.open(path.join(root, 'data'))).store
  const data = store.get()
  await store.replace({
    ...data,
    categories: [{ id: 'school', name: 'School', createdAt: '2026-10-01T00:00:00.000Z' }],
  })
  changes = 0
  checks = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('reading the suggestions folder', () => {
  it('does nothing until a folder is chosen', async () => {
    const importer = makeImporter()
    expect(await importer.check()).toEqual([])
    expect(changes).toBe(0)
    expect(importer.status()).toEqual({ folder: null, lastCheckedAt: null, folderError: null })
  })

  it('imports .json files, skips everything else, and saves once', async () => {
    await useFolder(inbox)
    await fs.writeFile(
      path.join(inbox, 'school-email.json'),
      suggestions([item('m1', 'Register for the career fair')]),
    )
    await fs.writeFile(path.join(inbox, 'notes.txt'), 'not a suggestions file')
    await fs.writeFile(path.join(inbox, '.hidden.json'), suggestions([item('h', 'Hidden')]))
    await fs.mkdir(path.join(inbox, 'sub'))
    await fs.writeFile(path.join(inbox, 'sub', 'nested.json'), suggestions([item('n', 'Nested')]))

    const importer = makeImporter()
    const reports = await importer.check()
    expect(reports.map((r) => [r.file, r.created])).toEqual([['school-email.json', 1]])
    expect(store.get().tasks.map((t) => t.title)).toEqual(['Register for the career fair'])
    expect(changes).toBe(1)
    expect(checks.at(-1)?.status).toMatchObject({ folder: inbox, folderError: null })
    expect(importer.status().lastCheckedAt).toBe('2026-10-12T16:10:00.000Z')

    // Saved to disk, so it survives a restart.
    const reopened = await Store.open(path.join(root, 'data'))
    expect(reopened.store.get().tasks).toHaveLength(1)
  })

  it('does not read an unchanged file again or write the data file for nothing', async () => {
    await useFolder(inbox)
    await fs.writeFile(path.join(inbox, 'a.json'), suggestions([item('m1', 'Reply to Prof. Bryan')]))
    const importer = makeImporter()
    await importer.check()
    const before = await fs.stat(path.join(root, 'data', 'task-tracker-data.json'))
    changes = 0

    expect(await importer.check()).toEqual([])
    expect(changes).toBe(0)
    const after = await fs.stat(path.join(root, 'data', 'task-tracker-data.json'))
    expect(after.mtimeMs).toBe(before.mtimeMs)

    // A changed file is read again; known items are not duplicated.
    await fs.writeFile(
      path.join(inbox, 'a.json'),
      suggestions([item('m1', 'Reply to Prof. Bryan'), item('m2', 'Review TA application')]),
    )
    const [report] = await importer.check()
    expect(report).toMatchObject({ created: 1, unchanged: 1 })
    expect(store.get().tasks).toHaveLength(2)
  })

  it('reports a missing folder (e.g. Google Drive not running) and keeps everything', async () => {
    await useFolder(path.join(root, 'gone'))
    const importer = makeImporter()
    expect(await importer.check()).toEqual([])
    expect(importer.status().folderError).toMatch(/can’t be found/)
    expect(changes).toBe(0)
  })

  it('refuses files over 1 MB without reading them, once', async () => {
    await useFolder(inbox)
    await fs.writeFile(path.join(inbox, 'huge.json'), ' '.repeat(1_000_001))
    const importer = makeImporter()
    const [report] = await importer.check()
    expect(report.error).toBe('The file is larger than 1 MB, so it wasn’t read.')
    expect(await importer.check()).toEqual([])
  })

  it('shares one check between overlapping calls', async () => {
    await useFolder(inbox)
    await fs.writeFile(path.join(inbox, 'a.json'), suggestions([item('m1', 'One')]))
    const importer = makeImporter()
    const [first, second] = await Promise.all([importer.check(), importer.check()])
    expect(first).toBe(second)
    expect(store.get().tasks).toHaveLength(1)
  })

  it('keeps edits made in the window while files were being read', async () => {
    await useFolder(inbox)
    await fs.writeFile(path.join(inbox, 'a.json'), suggestions([item('m1', 'From the folder')]))
    const importer = makeImporter()
    const pending = importer.check()
    // A change saved by the window before the importer applies its result.
    const data = store.get()
    await store.replace({
      ...data,
      categories: [...data.categories, { id: 'bsu', name: 'BSU', createdAt: data.categories[0].createdAt }],
    })
    await pending
    expect(store.get().categories.map((c) => c.name)).toEqual(['School', 'BSU'])
    expect(store.get().tasks.map((t) => t.title)).toEqual(['From the folder'])
  })
})
