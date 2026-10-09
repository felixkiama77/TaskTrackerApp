import { mkdtempSync, rmSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATA_FILE, Store } from '../../electron/store'
import { emptyAppData, type AppData } from '../../src/domain/types'
import { makeTask } from '../unit/helpers'

let dir: string
const file = () => path.join(dir, DATA_FILE)
const readJson = async (name = DATA_FILE) =>
  JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as AppData
const listDir = () => fs.readdir(dir)

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'tasktracker-store-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Store persistence (FR-33, FR-34, FR-38)', () => {
  it('creates an empty data file on first run', async () => {
    const { store, issues } = await Store.open(dir)
    expect(issues).toEqual([])
    expect(store.get()).toEqual(emptyAppData())
    expect(await readJson()).toEqual(emptyAppData())
  })

  it('round-trips data across restarts and leaves no temp files behind', async () => {
    const { store } = await Store.open(dir)
    const data = { ...emptyAppData(), tasks: [makeTask({ id: 'a' })] }
    await store.replace(data)
    const reopened = await Store.open(dir)
    expect(reopened.store.get()).toEqual(data)
    expect((await listDir()).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('serializes concurrent writes so the last change wins on disk', async () => {
    const { store } = await Store.open(dir)
    const writes = ['a', 'b', 'c'].map((id) =>
      store.replace({ ...emptyAppData(), tasks: [makeTask({ id })] }),
    )
    await Promise.all(writes)
    expect((await readJson()).tasks.map((t) => t.id)).toEqual(['c'])
  })

  it('restores the backup when the data file is unreadable, keeping the bad file', async () => {
    const { store } = await Store.open(dir)
    await store.replace({ ...emptyAppData(), tasks: [makeTask({ id: 'good' })] })
    await Store.open(dir) // a successful load refreshes the .bak copy
    await fs.writeFile(file(), '{ this is not json', 'utf8')

    const { store: recovered, issues } = await Store.open(dir)
    expect(issues.map((i) => i.kind)).toEqual(['restored-from-backup'])
    expect(recovered.get().tasks.map((t) => t.id)).toEqual(['good'])
    const names = await listDir()
    expect(names.some((n) => n.startsWith('task-tracker-data.unreadable-'))).toBe(true)
  })

  it('starts empty, but never deletes the unreadable file, when there is no usable backup', async () => {
    await fs.writeFile(file(), JSON.stringify({ version: 99, tasks: [] }), 'utf8')
    const { store, issues } = await Store.open(dir)
    expect(issues.map((i) => i.kind)).toEqual(['reset'])
    expect(store.get().tasks).toEqual([])
    const aside = (await listDir()).find((n) => n.startsWith('task-tracker-data.unreadable-'))!
    expect(JSON.parse(await fs.readFile(path.join(dir, aside), 'utf8'))).toEqual({ version: 99, tasks: [] })
  })

  it('quarantines invalid records instead of dropping them, and removes links to missing categories', async () => {
    const doc = {
      ...emptyAppData(),
      categories: [{ id: 'c1', name: 'Work', createdAt: '2026-01-01T00:00:00.000Z' }],
      tasks: [
        makeTask({ id: 'ok', categoryIds: ['c1', 'missing'] }),
        { id: 'broken', title: '' },
        makeTask({ id: 'ok' }),
      ],
      settings: { remindersEnabled: 'yes please' },
    }
    await fs.writeFile(file(), JSON.stringify(doc), 'utf8')
    const { store, issues } = await Store.open(dir)
    expect(store.get().tasks.map((t) => t.id)).toEqual(['ok'])
    expect(store.get().tasks[0].categoryIds).toEqual(['c1'])
    // An invalid setting falls back to its default rather than failing the whole load.
    expect(store.get().settings.remindersEnabled).toBe(true)
    expect(issues.map((i) => i.kind)).toEqual(['quarantined'])
    const quarantineFile = (await listDir()).find((n) => n.startsWith('task-tracker-quarantine-'))!
    const quarantined = JSON.parse(await fs.readFile(path.join(dir, quarantineFile), 'utf8')) as unknown[]
    expect(quarantined).toHaveLength(2)
  })

  it('rolls back the in-memory state when a write fails', async () => {
    const { store } = await Store.open(dir)
    const before = store.get()
    // Make the data file path a directory so the final rename cannot succeed.
    await fs.rm(file())
    await fs.mkdir(file())
    await expect(store.replace({ ...emptyAppData(), tasks: [makeTask()] })).rejects.toThrow()
    expect(store.get()).toBe(before)
  })
})
