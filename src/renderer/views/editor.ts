import { dateParts, localDateOf, weekdayOf, type LocalDate, type Weekday } from '../../domain/dates'
import { describeRecurrence, describeReminder, formatLongDate, formatTime } from '../../domain/format'
import type { Occurrence } from '../../domain/occurrences'
import { fieldErrors, TaskInputSchema, type TaskInput, type UpdateScope } from '../../domain/schemas'
import { DIFFICULTY_LABEL, REMINDER_PRESETS, type Difficulty, type Recurrence } from '../../domain/types'
import { chooseDialog, openDialog } from '../components/dialog'
import { h, icon, mount, uid } from '../dom'
import { Check, CircleAlert, Plus, Repeat, Trash } from '../icons'
import { state } from '../state'
import type { Actions } from '../actions'

type RepeatKind = Recurrence['kind']

interface FormState {
  title: string
  dueDate: string
  dueTime: string
  difficulty: Difficulty
  repeat: RepeatKind
  weekdays: Set<Weekday>
  endKind: 'never' | 'count'
  count: string
  categoryIds: Set<string>
  reminders: Set<number>
}

export type EditorTarget = { mode: 'create' } | { mode: 'edit'; occ: Occurrence }

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

function initialState(target: EditorTarget, today: LocalDate): FormState {
  if (target.mode === 'create') {
    return {
      title: '',
      dueDate: today,
      dueTime: '',
      difficulty: 'medium',
      repeat: 'once',
      weekdays: new Set([weekdayOf(today)]),
      endKind: 'never',
      count: '10',
      categoryIds: new Set(),
      reminders: new Set(),
    }
  }
  const { task, date } = target.occ
  return {
    title: task.title,
    dueDate: date,
    dueTime: task.dueTime ?? '',
    difficulty: task.difficulty,
    repeat: task.recurrence.kind,
    weekdays: new Set(task.recurrence.kind === 'weekly' ? task.recurrence.weekdays : [weekdayOf(date)]),
    endKind: task.end.kind,
    count: task.end.kind === 'count' ? String(task.end.count) : '10',
    categoryIds: new Set(task.categoryIds),
    reminders: new Set(task.reminders),
  }
}

function toInput(form: FormState, target: EditorTarget): TaskInput {
  let recurrence: Recurrence
  switch (form.repeat) {
    case 'once':
    case 'daily':
      recurrence = { kind: form.repeat }
      break
    case 'weekly':
      recurrence = { kind: 'weekly', weekdays: [...form.weekdays].sort((a, b) => a - b) }
      break
    case 'monthly': {
      // Keep a series' anchor (e.g. the 31st shown on Feb 28) unless the date was changed.
      const original = target.mode === 'edit' ? target.occ : null
      const keepAnchor = original?.task.recurrence.kind === 'monthly' && original.date === form.dueDate
      const day = /^\d{4}-\d{2}-\d{2}$/.test(form.dueDate) ? dateParts(form.dueDate).day : 1
      recurrence = {
        kind: 'monthly',
        dayOfMonth:
          keepAnchor && original.task.recurrence.kind === 'monthly'
            ? original.task.recurrence.dayOfMonth
            : day,
      }
      break
    }
  }
  return {
    title: form.title,
    difficulty: form.difficulty,
    dueDate: form.dueDate,
    dueTime: form.dueTime === '' ? null : form.dueTime,
    recurrence,
    end:
      form.repeat === 'once' || form.endKind === 'never'
        ? { kind: 'never' }
        : { kind: 'count', count: form.count.trim() === '' ? 0 : Number(form.count) },
    categoryIds: [...form.categoryIds],
    reminders: [...form.reminders].sort((a, b) => a - b),
  }
}

/** Opens the create/edit dialog. Resolves when it closes. */
export function openTaskEditor(target: EditorTarget, actions: Actions): void {
  const today = localDateOf(actions.now())
  const form = initialState(target, today)
  const isEdit = target.mode === 'edit'
  const original = isEdit ? target.occ : null
  const recurringOriginal = original !== null && original.task.recurrence.kind !== 'once'
  const errors = new Map<string, HTMLElement>()
  const formError = h('div', { class: 'form-error', role: 'alert', hidden: true })

  const fieldError = (key: string) => {
    const el = h('p', { class: 'field__error', id: uid('error'), hidden: true })
    errors.set(key, el)
    return el
  }

  // --- Name
  const titleError = fieldError('title')
  const titleInput = h('input', {
    class: 'input',
    type: 'text',
    id: uid('title'),
    value: form.title,
    maxlength: 200,
    required: true,
    autocomplete: 'off',
    'aria-describedby': titleError.id,
    onInput: (e: Event) => (form.title = (e.target as HTMLInputElement).value),
  })

  // --- Due date and time
  const dateError = fieldError('dueDate')
  const timeError = fieldError('dueTime')
  const dueHint = h('p', { class: 'field__hint', id: uid('hint') })
  const dateInput = h('input', {
    class: 'input',
    type: 'date',
    id: uid('date'),
    value: form.dueDate,
    required: true,
    'aria-describedby': dateError.id,
    onInput: (e: Event) => {
      const previousWeekday = /^\d{4}-\d{2}-\d{2}$/.test(form.dueDate) ? weekdayOf(form.dueDate) : null
      form.dueDate = (e.target as HTMLInputElement).value
      // Moving the date of a single-day weekly schedule moves its weekday with it.
      if (
        form.dueDate &&
        previousWeekday !== null &&
        form.weekdays.size === 1 &&
        form.weekdays.has(previousWeekday)
      ) {
        form.weekdays = new Set([weekdayOf(form.dueDate)])
      }
      renderRepeat()
      renderReminders()
    },
  })
  const timeInput = h('input', {
    class: 'input',
    type: 'time',
    id: uid('time'),
    value: form.dueTime,
    'aria-describedby': `${dueHint.id} ${timeError.id}`,
    onInput: (e: Event) => {
      form.dueTime = (e.target as HTMLInputElement).value
      renderDueHint()
      renderReminders()
    },
  })
  const renderDueHint = () => {
    mount(
      dueHint,
      form.dueTime
        ? 'The task becomes overdue after this time.'
        : 'Without a time, the task is due by the end of the day.',
    )
  }
  renderDueHint()

  // --- Difficulty
  const difficultyName = uid('difficulty')
  const difficulty = h(
    'fieldset',
    { class: 'fieldset' },
    h('legend', null, 'Difficulty'),
    h(
      'div',
      { class: 'segmented' },
      DIFFICULTIES.map((d) =>
        h(
          'label',
          { class: 'segmented__option' },
          h('input', {
            type: 'radio',
            name: difficultyName,
            value: d,
            checked: form.difficulty === d,
            onChange: () => (form.difficulty = d),
          }),
          h('span', null, DIFFICULTY_LABEL[d]),
        ),
      ),
    ),
  )

  // --- Repeat
  const repeatSelect = h(
    'select',
    {
      class: 'select',
      id: uid('repeat'),
      onChange: (e: Event) => {
        form.repeat = (e.target as HTMLSelectElement).value as RepeatKind
        if (form.repeat === 'weekly' && form.weekdays.size === 0 && form.dueDate) {
          form.weekdays.add(weekdayOf(form.dueDate))
        }
        renderRepeat()
      },
    },
    [
      ['once', 'Does not repeat'],
      ['daily', 'Every day'],
      ['weekly', 'Weekly on selected days'],
      ['monthly', 'Every month'],
    ].map(([value, label]) => h('option', { value, selected: form.repeat === value }, label)),
  )
  const weekdaysError = fieldError('recurrence.weekdays')
  const countError = fieldError('end.count')
  const repeatDetails = h('div', { class: 'disclosure', hidden: true })

  const countInput = h('input', {
    class: 'input input--sm input--narrow',
    type: 'number',
    min: 1,
    max: 1000,
    step: 1,
    value: form.count,
    'aria-label': 'Number of occurrences',
    'aria-describedby': countError.id,
    onInput: (e: Event) => {
      form.count = (e.target as HTMLInputElement).value
      renderSummary()
    },
    onFocus: () => {
      if (form.endKind !== 'count') {
        form.endKind = 'count'
        renderRepeat()
        countInput.focus()
      }
    },
  })
  const summary = h('p', { class: 'summary-line', 'aria-live': 'polite' })
  const renderSummary = () => {
    const input = toInput(form, target)
    const valid =
      (input.recurrence.kind !== 'weekly' || input.recurrence.weekdays.length > 0) &&
      (input.end.kind === 'never' || (Number.isInteger(input.end.count) && input.end.count >= 1))
    mount(
      summary,
      icon(Repeat, 14),
      valid ? describeRecurrence(input.recurrence, input.end, state.weekStart()) : '—',
    )
  }

  const endName = uid('end')
  const renderRepeat = () => {
    repeatDetails.hidden = form.repeat === 'once'
    if (form.repeat === 'once') return mount(repeatDetails)
    const weekStart = state.weekStart()
    const days = Array.from({ length: 7 }, (_, i) => ((weekStart + i) % 7) as Weekday)
    mount(
      repeatDetails,
      form.repeat === 'weekly' &&
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field__label', id: `${repeatSelect.id}-days` }, 'On these days'),
          h(
            'div',
            { class: 'toggle-chips', role: 'group', 'aria-labelledby': `${repeatSelect.id}-days` },
            days.map((d) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'toggle-chip toggle-chip--day',
                  'aria-pressed': String(form.weekdays.has(d)),
                  'aria-label': WEEKDAY_NAMES[d],
                  title: WEEKDAY_NAMES[d],
                  dataset: { focusKey: `day:${d}` },
                  onClick: () => {
                    if (form.weekdays.has(d)) form.weekdays.delete(d)
                    else form.weekdays.add(d)
                    renderRepeat()
                    repeatDetails.querySelector<HTMLElement>(`[data-focus-key="day:${d}"]`)?.focus()
                  },
                },
                WEEKDAY_NAMES[d].slice(0, 3),
              ),
            ),
          ),
          weekdaysError,
        ),
      form.repeat === 'monthly' &&
        h(
          'p',
          { class: 'field__hint' },
          (() => {
            const day = toInput(form, target).recurrence
            const n = day.kind === 'monthly' ? day.dayOfMonth : 1
            return n > 28
              ? `Repeats on day ${n} of each month. Months without day ${n} use their last day.`
              : `Repeats on day ${n} of each month.`
          })(),
        ),
      h(
        'fieldset',
        { class: 'fieldset' },
        h('legend', null, 'Ends'),
        h(
          'div',
          { class: 'choice-list' },
          h(
            'label',
            { class: 'choice' },
            h('input', {
              type: 'radio',
              name: endName,
              checked: form.endKind === 'never',
              onChange: () => {
                form.endKind = 'never'
                renderSummary()
              },
            }),
            'Never',
          ),
          h(
            'div',
            { class: 'choice' },
            h('input', {
              type: 'radio',
              name: endName,
              id: `${endName}-count`,
              checked: form.endKind === 'count',
              onChange: () => {
                form.endKind = 'count'
                renderSummary()
                countInput.focus()
              },
            }),
            h('label', { for: `${endName}-count` }, 'After'),
            countInput,
            h('span', null, 'occurrences in total'),
          ),
          countError,
        ),
      ),
      summary,
    )
    renderSummary()
  }

  // --- Categories
  const categoriesBox = h('div', { class: 'field' })
  const categoriesLabelId = uid('categories')
  const newCategoryInput = h('input', {
    class: 'input input--sm',
    type: 'text',
    maxlength: 40,
    placeholder: 'New category',
    'aria-label': 'New category name',
    onKeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void addCategory()
      }
    },
  })
  const addCategory = async () => {
    const name = newCategoryInput.value.trim()
    if (!name) return newCategoryInput.focus()
    const result = await actions.dispatch({ type: 'category/create', name }, { quiet: true })
    if (!result.ok) return
    const created = state.data.categories.find((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (created) form.categoryIds.add(created.id)
    newCategoryInput.value = ''
    renderCategories()
    newCategoryInput.focus()
  }
  const renderCategories = () => {
    const categories = state.data.categories
    const labelId = categoriesLabelId
    mount(
      categoriesBox,
      h(
        'span',
        { class: 'field__label', id: labelId },
        'Categories ',
        h('span', { class: 'field__optional' }, '(optional)'),
      ),
      categories.length > 0
        ? h(
            'div',
            { class: 'toggle-chips', role: 'group', 'aria-labelledby': labelId },
            categories.map((c) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'toggle-chip',
                  'aria-pressed': String(form.categoryIds.has(c.id)),
                  dataset: { focusKey: `cat:${c.id}` },
                  onClick: (e: Event) => {
                    if (form.categoryIds.has(c.id)) form.categoryIds.delete(c.id)
                    else form.categoryIds.add(c.id)
                    ;(e.currentTarget as HTMLElement).setAttribute(
                      'aria-pressed',
                      String(form.categoryIds.has(c.id)),
                    )
                  },
                },
                icon(Check, 13),
                c.name,
              ),
            ),
          )
        : h('p', { class: 'field__hint' }, 'No categories yet. Add one below.'),
      h(
        'div',
        { class: 'inline-form' },
        newCategoryInput,
        h(
          'button',
          { type: 'button', class: 'btn btn--sm', onClick: () => void addCategory() },
          icon(Plus, 14),
          'Add',
        ),
      ),
    )
  }

  // --- Reminders
  const remindersBox = h('div', { class: 'field' })
  const remindersLabelId = uid('reminders')
  const renderReminders = () => {
    const hasTime = form.dueTime !== ''
    const labelId = remindersLabelId
    const anchor = formatTime(state.data.settings.dateOnlyReminderTime)
    mount(
      remindersBox,
      h(
        'span',
        { class: 'field__label', id: labelId },
        'Reminders ',
        h('span', { class: 'field__optional' }, '(optional)'),
      ),
      h(
        'div',
        { class: 'toggle-chips', role: 'group', 'aria-labelledby': labelId },
        REMINDER_PRESETS.map((lead) =>
          h(
            'button',
            {
              type: 'button',
              class: 'toggle-chip toggle-chip--sm',
              'aria-pressed': String(form.reminders.has(lead)),
              onClick: (e: Event) => {
                if (form.reminders.has(lead)) form.reminders.delete(lead)
                else form.reminders.add(lead)
                ;(e.currentTarget as HTMLElement).setAttribute(
                  'aria-pressed',
                  String(form.reminders.has(lead)),
                )
                renderReminderHint()
              },
            },
            icon(Check, 12),
            describeReminder(lead, hasTime),
          ),
        ),
      ),
      reminderHint,
    )
    renderReminderHint()
    function renderReminderHint() {
      const notes: string[] = []
      if (form.reminders.size === 0) notes.push('No reminders.')
      else if (!hasTime)
        notes.push(`Without a due time, reminders are measured from ${anchor} on the due date.`)
      if (form.reminders.size > 0 && !state.data.settings.remindersEnabled) {
        notes.push('Reminders are currently turned off in Settings.')
      }
      mount(reminderHint, notes.join(' '))
    }
  }
  const reminderHint = h('p', { class: 'field__hint' })

  // --- Assemble
  const field = (label: string, control: HTMLElement, ...extra: (HTMLElement | false)[]) =>
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field__label', for: control.id }, label),
      control,
      ...extra,
    )

  const formId = uid('form')
  const submitButton = h(
    'button',
    { type: 'submit', class: 'btn btn--primary', form: formId },
    isEdit ? 'Save changes' : 'Create task',
  )
  const formEl = h(
    'form',
    { id: formId, novalidate: true },
    formError,
    field('Name', titleInput, titleError),
    h(
      'div',
      { class: 'field-row' },
      field('Due date', dateInput, dateError),
      h(
        'div',
        { class: 'field' },
        h(
          'label',
          { class: 'field__label', for: timeInput.id },
          'Due time ',
          h('span', { class: 'field__optional' }, '(optional)'),
        ),
        timeInput,
        timeError,
      ),
    ),
    dueHint,
    difficulty,
    field('Repeat', repeatSelect),
    repeatDetails,
    categoriesBox,
    remindersBox,
  )

  renderRepeat()
  renderCategories()
  renderReminders()

  const showErrors = (messages: Record<string, string>) => {
    for (const [key, el] of errors) {
      const message = messages[key]
      el.hidden = !message
      mount(el, message ? [icon(CircleAlert, 13), message] : [])
    }
    const invalidControls: [string, HTMLElement][] = [
      ['title', titleInput],
      ['dueDate', dateInput],
      ['dueTime', timeInput],
      ['end.count', countInput],
    ]
    for (const [key, control] of invalidControls)
      control.setAttribute('aria-invalid', String(Boolean(messages[key])))
    const other = Object.entries(messages).filter(([key]) => !errors.has(key))
    formError.hidden = Object.keys(messages).length === 0
    mount(
      formError,
      formError.hidden
        ? []
        : [
            icon(CircleAlert, 16),
            h(
              'span',
              null,
              other.length ? other.map(([, m]) => m).join(' ') : 'Please fix the highlighted fields.',
            ),
          ],
    )
    const firstInvalid = invalidControls.find(([key]) => messages[key])?.[1]
    if (firstInvalid) {
      firstInvalid.focus()
      firstInvalid.scrollIntoView({ block: 'center' })
    } else if (messages['recurrence.weekdays'])
      repeatDetails.querySelector<HTMLElement>('.toggle-chip')?.focus()
  }

  const showFormError = (message: string) => {
    formError.hidden = false
    mount(formError, icon(CircleAlert, 16), h('span', null, message))
    formError.scrollIntoView({ block: 'nearest' })
  }

  let saving = false
  formEl.addEventListener('submit', (event) => {
    event.preventDefault()
    if (saving) return
    void (async () => {
      const parsed = TaskInputSchema.safeParse(toInput(form, target))
      if (!parsed.success) return showErrors(fieldErrors(parsed.error))
      showErrors({})
      let scope: UpdateScope = { kind: 'series' }
      if (original && recurringOriginal) {
        const chosen = await chooseEditScope(original, parsed.data)
        if (!chosen) return
        scope = chosen
      }
      saving = true
      submitButton.disabled = true
      const result = await actions.dispatch(
        original
          ? { type: 'task/update', taskId: original.taskId, input: parsed.data, scope }
          : { type: 'task/create', input: parsed.data },
        { quiet: true },
      )
      saving = false
      submitButton.disabled = false
      if (!result.ok) return showFormError(result.error)
      handle.close()
      actions.toast({ tone: 'success', title: result.message })
    })()
  })

  const unsubscribe = state.subscribe(() => renderCategories())

  const handle = openDialog({
    title: isEdit ? 'Edit task' : 'New task',
    subtitle: original && recurringOriginal ? `Occurrence on ${formatLongDate(original.date)}` : undefined,
    bodyElement: formEl,
    initialFocus: titleInput,
    footer: [
      original &&
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--danger',
            onClick: () => {
              handle.close()
              void actions.deleteOccurrence(original)
            },
          },
          icon(Trash, 16),
          'Delete',
        ),
      h('span', { class: 'dialog__footer-spacer' }),
      h('button', { type: 'button', class: 'btn', onClick: () => handle.close() }, 'Cancel'),
      submitButton,
    ],
    onClose: unsubscribe,
  })
}

function sameSchedule(occ: Occurrence, input: TaskInput): boolean {
  const { task } = occ
  return (
    JSON.stringify(task.recurrence) === JSON.stringify(input.recurrence) &&
    JSON.stringify(task.end) === JSON.stringify(input.end)
  )
}

/** For recurring tasks: apply to this occurrence only, or to it and all later ones (docs/DECISIONS.md #7). */
async function chooseEditScope(occ: Occurrence, input: TaskInput): Promise<UpdateScope | null> {
  const when = formatLongDate(occ.date)
  if (!sameSchedule(occ, input)) {
    const ok = await chooseDialog({
      title: 'Change the repeat schedule?',
      message: `Changing how a task repeats applies from ${when} onward. Earlier occurrences and completed history stay as they are.`,
      choices: [{ value: true, title: 'This and future occurrences', text: `Starting ${when}` }],
    })
    return ok ? { kind: 'future', key: occ.key } : null
  }
  return chooseDialog<UpdateScope>({
    title: 'Edit a repeating task',
    message: 'Which occurrences should this change apply to? Completed history is never changed.',
    choices: [
      { value: { kind: 'occurrence', key: occ.key }, title: 'Only this occurrence', text: when },
      {
        value: { kind: 'future', key: occ.key },
        title: 'This and future occurrences',
        text: `Starting ${when}`,
      },
    ],
  })
}
