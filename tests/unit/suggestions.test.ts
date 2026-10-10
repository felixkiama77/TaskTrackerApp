import { describe, expect, it } from 'vitest'
import { applyCommand } from '../../src/domain/commands'
import { forgetMissingFiles, importSuggestionsFile, type Suggestion } from '../../src/domain/suggestions'
import { emptyAppData, MAX_TASKS, type AppData } from '../../src/domain/types'
import { at, makeCtx, makeInput, makeTask } from './helpers'

const NOW = at('2026-10-11', '17:07')

/** Data with the given categories; "School" and "TCSS 380" by default, as in the real app. */
function withCategories(...names: string[]): AppData {
  if (names.length === 0) names = ['School', 'TCSS 380']
  const data = emptyAppData()
  data.categories = names.map((name, i) => ({ id: `cat-${i}`, name, createdAt: '2026-10-01T00:00:00.000Z' }))
  return data
}

const lab = (overrides: Partial<Suggestion> = {}): Partial<Suggestion> => ({
  system: 'tcss380-site',
  externalId: '2026au/week-3/lab-2',
  title: 'Lab 2: Erlang recursion',
  notes: 'Week 3 lab from the TCSS 380 site.',
  link: 'https://cfb3.github.io/TCSS380-26-AUTUMN/erlang/lab-2/',
  dueDate: '2026-10-18',
  dueTime: '23:59',
  priority: 'medium',
  categories: ['school', 'TCSS 380'],
  reminders: [720, 360],
  ...overrides,
})

function file(suggestions: unknown[], name = 'weekly-coursework.json') {
  const text = JSON.stringify({
    format: 'task-tracker-suggestions',
    version: 1,
    origin: 'Weekly coursework sync',
    generatedAt: '2026-10-11T17:07:00-07:00',
    suggestions,
  })
  return { name, hash: `hash-of-${text.length}-${text}`, text }
}

function run(data: AppData, suggestions: unknown[], ctx = makeCtx(NOW)) {
  return importSuggestionsFile(data, file(suggestions), ctx)
}

describe('importing suggested tasks', () => {
  it('adds a one-time task with mapped categories, sorted reminders, notes, link and its source', () => {
    const { data, report } = run(withCategories('School', 'TCSS 380', 'TCSS 360'), [lab()])
    expect(report).toMatchObject({ error: null, created: 1, updated: 0, unchanged: 0, notes: [] })
    expect(report.origin).toBe('Weekly coursework sync')
    const [task] = data.tasks
    expect(task).toMatchObject({
      title: 'Lab 2: Erlang recursion',
      startDate: '2026-10-18',
      dueTime: '23:59',
      recurrence: { kind: 'once' },
      priority: 'medium',
      categoryIds: ['cat-0', 'cat-1'],
      reminders: [360, 720],
      notes: 'Week 3 lab from the TCSS 380 site.',
      link: 'https://cfb3.github.io/TCSS380-26-AUTUMN/erlang/lab-2/',
    })
    expect(task.source).toMatchObject({
      system: 'tcss380-site',
      externalId: '2026au/week-3/lab-2',
      origin: 'Weekly coursework sync',
    })
    expect(data.imports.seen['tcss380-site:2026au/week-3/lab-2']).toBeDefined()
    expect(Object.keys(data.imports.files)).toEqual(['weekly-coursework.json'])
    expect(data.imports.reports[0]).toBe(report)
  })

  it('changes nothing when the same suggestions are imported again', () => {
    const first = run(withCategories('School', 'TCSS 380'), [lab()]).data
    const second = run(first, [lab()])
    expect(second.report).toMatchObject({ created: 0, updated: 0, unchanged: 1 })
    expect(second.data.tasks).toEqual(first.tasks)
  })

  it('updates fields you have not touched when the source changes', () => {
    const first = run(withCategories('School', 'TCSS 380'), [lab()]).data
    const ctx = makeCtx(NOW + 86_400_000)
    const { data, report } = run(first, [lab({ dueDate: '2026-10-19', title: 'Lab 2 (extended)' })], ctx)
    expect(report).toMatchObject({ updated: 1, notes: [] })
    expect(data.tasks[0]).toMatchObject({ startDate: '2026-10-19', title: 'Lab 2 (extended)' })
    expect(data.tasks[0].source?.imported.dueDate).toBe('2026-10-19')
  })

  it('never overwrites a field you edited, and says so once', () => {
    const first = run(withCategories('School', 'TCSS 380'), [lab()]).data
    const task = first.tasks[0]
    // You move the due date earlier and rename the task in the app.
    const edited = applyCommand(
      first,
      {
        type: 'task/update',
        taskId: task.id,
        scope: { kind: 'series' },
        input: makeInput({
          title: 'Lab 2 — finish early',
          dueDate: '2026-10-16',
          dueTime: '23:59',
          priority: 'medium',
          notes: task.notes,
          link: task.link,
          categoryIds: task.categoryIds,
          reminders: task.reminders,
        }),
      },
      makeCtx(NOW),
    ).data
    expect(edited.tasks[0].source).toEqual(task.source) // Editing keeps where it came from.

    // The source then moves the deadline and changes the notes.
    const changed = run(edited, [lab({ dueDate: '2026-10-25', notes: 'Deadline extended.' })])
    expect(changed.data.tasks[0]).toMatchObject({
      title: 'Lab 2 — finish early',
      startDate: '2026-10-16',
      notes: 'Deadline extended.', // untouched by you, so it follows the source
    })
    expect(changed.report.updated).toBe(1)
    expect(changed.report.notes).toEqual([
      '“Lab 2 — finish early”: kept your due date; the source changed it.',
    ])

    // Importing the same file again doesn't repeat the note.
    const again = run(changed.data, [lab({ dueDate: '2026-10-25', notes: 'Deadline extended.' })])
    expect(again.report).toMatchObject({ updated: 0, unchanged: 1, notes: [] })
  })

  it('never adds back a task you deleted', () => {
    const first = run(withCategories('School', 'TCSS 380'), [lab()]).data
    const deleted = applyCommand(
      first,
      { type: 'task/delete', taskId: first.tasks[0].id, scope: { kind: 'series' } },
      makeCtx(NOW),
    ).data
    const { data, report } = run(deleted, [lab()])
    expect(data.tasks).toEqual([])
    expect(report).toMatchObject({ created: 0, unchanged: 1 })
    expect(report.notes).toEqual(['1 suggestion for a task you deleted was not added again.'])
  })

  it('leaves completed and skipped tasks alone', () => {
    const first = run(withCategories('School', 'TCSS 380'), [lab()]).data
    const id = first.tasks[0].id
    const done = applyCommand(
      first,
      { type: 'occurrence/complete', taskId: id, key: '2026-10-18' },
      makeCtx(NOW),
    ).data
    const result = run(done, [lab({ dueDate: '2026-10-25' })])
    expect(result.data.tasks[0].startDate).toBe('2026-10-18')
    expect(result.data.tasks[0].completed['2026-10-18']).toBeDefined()
    expect(result.report).toMatchObject({ updated: 0, unchanged: 1 })
  })

  it('does not delete anything that is missing from a later file', () => {
    const first = run(withCategories(), [lab(), lab({ externalId: 'other', title: 'Quiz 3' })]).data
    const { data, report } = run(first, [lab()])
    expect(data.tasks.map((t) => t.title)).toEqual(['Lab 2: Erlang recursion', 'Quiz 3'])
    expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 1 })
  })

  it('leaves out unknown categories instead of creating them, and reports them', () => {
    const { data, report } = run(withCategories('School'), [
      lab({ categories: ['School', 'Research', 'BSU'] }),
    ])
    expect(data.categories).toHaveLength(1)
    expect(data.tasks[0].categoryIds).toEqual(['cat-0'])
    expect(report.notes).toEqual([
      'No category named “Research” and “BSU”, so they were left off. Create them in Categories to use them next time.',
    ])
  })

  it('skips invalid suggestions one by one and keeps the valid ones', () => {
    const { data, report } = run(withCategories(), [
      lab({ externalId: 'a' }),
      { ...lab({ externalId: 'b' }), dueDate: '2026-02-30' },
      { ...lab({ externalId: 'c' }), link: 'http://insecure.example.com' },
      { ...lab({ externalId: 'd' }), reminders: [45] },
      { ...lab({ externalId: 'e' }), system: 'Canvas LMS' },
    ])
    expect(data.tasks.map((t) => t.source?.externalId)).toEqual(['a'])
    expect(report.created).toBe(1)
    expect(report.notes).toHaveLength(4)
    expect(report.notes[0]).toMatch(/^Suggestion 2 was skipped because it isn’t valid \(dueDate:/)
  })

  it('uses only the first of two suggestions with the same id', () => {
    const { data, report } = run(withCategories(), [lab(), lab({ title: 'Duplicate' })])
    expect(data.tasks.map((t) => t.title)).toEqual(['Lab 2: Erlang recursion'])
    expect(report.notes).toEqual(['“Duplicate” appears twice in the file; only the first was used.'])
  })

  it('treats the same id from different systems as different items', () => {
    const { data } = run(withCategories(), [lab({ system: 'canvas' }), lab({ system: 'tcss380-site' })])
    expect(data.tasks).toHaveLength(2)
  })

  it('changes nothing but the report when the file is not valid', () => {
    const start = withCategories('School')
    const notJson = importSuggestionsFile(start, { name: 'x.json', hash: 'h1', text: '{ nope' }, makeCtx(NOW))
    expect(notJson.report.error).toBe('The file isn’t valid JSON, so nothing was imported.')
    expect(notJson.data.tasks).toEqual([])
    expect(notJson.data.imports.files['x.json']).toBe('h1') // not re-read until it changes

    const wrongFormat = importSuggestionsFile(
      start,
      { name: 'y.json', hash: 'h2', text: JSON.stringify({ format: 'something-else', suggestions: [] }) },
      makeCtx(NOW),
    )
    expect(wrongFormat.report.error).toMatch(/^The file isn’t a Task Tracker suggestions file/)
    expect(wrongFormat.data.tasks).toEqual([])
  })

  it('respects the task limit', () => {
    const start = withCategories()
    start.tasks = Array.from({ length: MAX_TASKS }, (_, i) => makeTask({ id: `t${i}` }))
    const { data, report } = run(start, [lab()])
    expect(data.tasks).toHaveLength(MAX_TASKS)
    expect(report.notes).toEqual([
      '“Lab 2: Erlang recursion” wasn’t added because the task limit has been reached.',
    ])
  })

  it('keeps only the 20 most recent reports', () => {
    let data = withCategories()
    for (let i = 0; i < 25; i++) data = run(data, [lab({ externalId: `item-${i}` })]).data
    expect(data.imports.reports).toHaveLength(20)
  })

  it('forgets processed files that are no longer in the folder', () => {
    const data = run(withCategories(), [lab()]).data
    expect(forgetMissingFiles(data, ['weekly-coursework.json'])).toBe(data)
    expect(forgetMissingFiles(data, []).imports.files).toEqual({})
  })
})
