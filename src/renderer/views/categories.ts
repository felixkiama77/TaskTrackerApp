import { CategoryNameSchema } from '../../domain/schemas'
import type { Category } from '../../domain/types'
import type { Actions } from '../actions'
import { confirmDialog } from '../components/dialog'
import { emptyState } from '../components/parts'
import { h, icon, mount, uid } from '../dom'
import { CircleAlert, ListTodo, Pencil, Plus, Tags, Trash } from '../icons'
import { state } from '../state'
import type { ViewContent } from './shell'

/** Which category is being renamed inline (view state that survives re-renders). */
let renamingId: string | null = null

function taskCount(categoryId: string): number {
  return state.data.tasks.filter((t) => t.categoryIds.includes(categoryId)).length
}

function nameForm(options: {
  initial: string
  submitLabel: string
  label: string
  placeholder?: string
  focusKey: string
  onSubmit: (name: string) => Promise<string | null>
  onCancel?: () => void
}): HTMLFormElement {
  const errorEl = h('p', { class: 'field__error', id: uid('cat-error'), hidden: true })
  const input = h('input', {
    class: 'input',
    type: 'text',
    maxlength: 40,
    value: options.initial,
    placeholder: options.placeholder,
    'aria-label': options.label,
    'aria-describedby': errorEl.id,
    autocomplete: 'off',
    dataset: { focusKey: options.focusKey },
  })
  const showError = (message: string | null) => {
    errorEl.hidden = !message
    input.setAttribute('aria-invalid', String(Boolean(message)))
    mount(errorEl, message ? [icon(CircleAlert, 13), message] : [])
  }
  const form = h(
    'form',
    {
      novalidate: true,
      onSubmit: (e: Event) => {
        e.preventDefault()
        const parsed = CategoryNameSchema.safeParse(input.value)
        if (!parsed.success) {
          showError(parsed.error.issues[0]?.message ?? 'Invalid name.')
          return input.focus()
        }
        void options.onSubmit(parsed.data).then((error) => {
          showError(error)
          if (error) input.focus()
        })
      },
    },
    h('div', { class: 'field' }, input, errorEl),
    h(
      'button',
      { type: 'submit', class: options.onCancel ? 'btn btn--primary btn--sm' : 'btn btn--primary' },
      options.submitLabel,
    ),
    options.onCancel &&
      h('button', { type: 'button', class: 'btn btn--sm', onClick: options.onCancel }, 'Cancel'),
  )
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && options.onCancel) {
      e.preventDefault()
      options.onCancel()
    }
  })
  return form
}

function categoryRow(category: Category, actions: Actions): HTMLLIElement {
  const count = taskCount(category.id)
  if (renamingId === category.id) {
    const form = nameForm({
      initial: category.name,
      submitLabel: 'Save',
      label: `New name for ${category.name}`,
      focusKey: `rename-input:${category.id}`,
      onSubmit: async (name) => {
        const result = await actions.dispatch(
          { type: 'category/rename', categoryId: category.id, name },
          { quiet: true },
        )
        if (!result.ok) return result.error
        renamingId = null
        state.refresh()
        actions.toast({ tone: 'success', title: result.message })
        return null
      },
      onCancel: () => {
        renamingId = null
        state.refresh()
      },
    })
    queueMicrotask(() => form.querySelector('input')?.select())
    return h('li', { class: 'category-row' }, form)
  }
  return h(
    'li',
    { class: 'category-row' },
    h('span', { class: 'category-row__name' }, h('span', { class: 'chip chip--category' }, category.name)),
    h('span', { class: 'category-row__count' }, count === 1 ? '1 task' : `${count} tasks`),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': `Show tasks in ${category.name}`,
        title: 'Show tasks',
        dataset: { focusKey: `cat-show:${category.id}` },
        onClick: () =>
          state.setUi({ route: { name: 'list', view: 'all' }, categoryFilter: new Set([category.id]) }),
      },
      icon(ListTodo, 16),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': `Rename ${category.name}`,
        title: 'Rename',
        dataset: { focusKey: `cat-rename:${category.id}` },
        onClick: () => {
          renamingId = category.id
          state.refresh()
        },
      },
      icon(Pencil, 16),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn icon-btn--danger',
        'aria-label': `Delete ${category.name}`,
        title: 'Delete',
        dataset: { focusKey: `cat-delete:${category.id}` },
        onClick: () => void deleteCategory(category, count, actions),
      },
      icon(Trash, 16),
    ),
  )
}

async function deleteCategory(category: Category, count: number, actions: Actions) {
  const tasks =
    count === 1 ? 'The 1 task in it' : count === 0 ? 'No tasks use it, and' : `The ${count} tasks in it`
  const ok = await confirmDialog({
    title: `Delete “${category.name}”?`,
    message: `${tasks} will be kept — only this category label is removed. Completed history keeps the name.`,
    confirmLabel: 'Delete category',
    danger: true,
  })
  if (!ok) return
  const result = await actions.dispatch({ type: 'category/delete', categoryId: category.id }, { quiet: true })
  actions.toast(
    result.ok
      ? { tone: 'success', title: result.message }
      : { tone: 'error', title: 'Couldn’t delete', body: result.error },
  )
}

/** Create, rename and delete categories (FR-6 – FR-8). */
export function categoriesView(actions: Actions): ViewContent {
  const categories = [...state.data.categories].sort((a, b) => a.name.localeCompare(b.name))
  const create = nameForm({
    initial: '',
    submitLabel: 'Add category',
    label: 'New category name',
    placeholder: 'New category name, e.g. School',
    focusKey: 'category-create',
    onSubmit: async (name) => {
      const result = await actions.dispatch({ type: 'category/create', name }, { quiet: true })
      if (!result.ok) return result.error
      actions.toast({ tone: 'success', title: result.message })
      const input = document.querySelector<HTMLInputElement>('[data-focus-key="category-create"]')
      if (input) input.value = ''
      return null
    },
  })
  create.classList.add('category-create')
  create.querySelector('button[type="submit"]')?.prepend(icon(Plus, 16))

  return {
    title: 'Categories',
    summary: 'Group tasks with labels. A task can have several; deleting a category never deletes its tasks.',
    body: [
      create,
      categories.length === 0
        ? emptyState({
            art: Tags,
            title: 'No categories yet',
            text: 'Add one above, or while creating a task.',
          })
        : h(
            'ul',
            { class: 'task-list', 'aria-label': 'Categories' },
            categories.map((c) => categoryRow(c, actions)),
          ),
    ],
  }
}
