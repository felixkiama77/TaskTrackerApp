import { h, icon, uid, type Child } from '../dom'
import { X } from '../icons'

/**
 * Modal dialogs on the native <dialog> element: it traps focus, closes on Escape, and makes the
 * rest of the page inert. Focus returns to whatever was focused before it opened.
 */
export interface DialogOptions {
  title: string
  subtitle?: string
  size?: 'sm' | 'md'
  body?: Child
  /** A ready-made body element (e.g. a <form>); it gets the dialog body styling. */
  bodyElement?: HTMLElement
  footer?: Child
  /** Element to focus first; defaults to the first focusable control in the body. */
  initialFocus?: HTMLElement
  onClose?: () => void
}

export interface DialogHandle {
  dialog: HTMLDialogElement
  close: () => void
}

export function openDialog(options: DialogOptions): DialogHandle {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const titleId = uid('dialog-title')
  const close = () => {
    if (dialog.open) dialog.close()
  }

  const body = options.bodyElement ?? h('div', null, options.body)
  body.classList.add('dialog__body')
  const dialog = h(
    'dialog',
    { class: ['dialog', options.size === 'sm' && 'dialog--sm'], 'aria-labelledby': titleId },
    h(
      'div',
      { class: 'dialog__header' },
      h(
        'div',
        null,
        h('h2', { id: titleId }, options.title),
        options.subtitle && h('p', { class: 'dialog__subtitle' }, options.subtitle),
      ),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onClick: close }, icon(X, 18)),
    ),
    body,
    options.footer !== undefined && h('div', { class: 'dialog__footer' }, options.footer),
  )

  dialog.addEventListener('close', () => {
    dialog.remove()
    options.onClose?.()
    if (opener?.isConnected) opener.focus()
  })

  document.body.append(dialog)
  dialog.showModal()
  const first =
    options.initialFocus ??
    body.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button, [tabindex="0"]')
  first?.focus()
  return { dialog, close }
}

export interface Choice<T> {
  value: T
  title: string
  text?: string
}

/** Asks the user to pick one of a few clearly explained options; resolves to null on cancel. */
export function chooseDialog<T>(options: {
  title: string
  message?: string
  choices: Choice<T>[]
}): Promise<T | null> {
  return new Promise((resolve) => {
    let result: T | null = null
    const handle = openDialog({
      title: options.title,
      size: 'sm',
      body: [
        options.message && h('p', null, options.message),
        h(
          'div',
          { class: 'choice-list' },
          options.choices.map((choice) =>
            h(
              'button',
              {
                type: 'button',
                class: 'choice-card',
                onClick: () => {
                  result = choice.value
                  handle.close()
                },
              },
              h('span', { class: 'choice-card__title' }, choice.title),
              choice.text && h('span', { class: 'choice-card__text' }, choice.text),
            ),
          ),
        ),
      ],
      footer: [
        h('span', { class: 'dialog__footer-spacer' }),
        h('button', { type: 'button', class: 'btn', onClick: () => handle.close() }, 'Cancel'),
      ],
      onClose: () => resolve(result),
    })
  })
}

/** A yes/no confirmation. The confirm button is styled as destructive when `danger` is set. */
export function confirmDialog(options: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false
    const cancel = h('button', { type: 'button', class: 'btn', onClick: () => handle.close() }, 'Cancel')
    const handle = openDialog({
      title: options.title,
      size: 'sm',
      body: h('p', null, options.message),
      footer: [
        h('span', { class: 'dialog__footer-spacer' }),
        cancel,
        h(
          'button',
          {
            type: 'button',
            class: ['btn', options.danger ? 'btn--danger' : 'btn--primary'],
            onClick: () => {
              confirmed = true
              handle.close()
            },
          },
          options.confirmLabel,
        ),
      ],
      // Safer default for destructive actions.
      initialFocus: cancel,
      onClose: () => resolve(confirmed),
    })
  })
}
