import { h, icon, mount } from '../dom'
import { BellRing, CircleAlert, CircleCheck, Info, TriangleAlert, X } from '../icons'

/**
 * In-app toasts (design spec §9). Readable, dismissible, announced to screen readers, and never
 * covering more than a few at a time. Errors stay longer and are announced assertively.
 */
export type ToastTone = 'info' | 'success' | 'error' | 'reminder' | 'overdue'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  tone: ToastTone
  title: string
  body?: string
  actions?: ToastAction[]
  /** Milliseconds before auto-dismissal; defaults depend on the tone. */
  duration?: number
}

const ICONS = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
  reminder: BellRing,
  overdue: TriangleAlert,
}
const MAX_VISIBLE = 3

export class Toaster {
  private readonly region: HTMLElement

  constructor(container: HTMLElement) {
    this.region = container
    container.className = 'toast-region'
    container.setAttribute('role', 'region')
    container.setAttribute('aria-label', 'Notifications')
  }

  show(options: ToastOptions): () => void {
    const duration =
      options.duration ?? (options.tone === 'error' ? 9000 : options.actions?.length ? 7000 : 5000)
    let timer: ReturnType<typeof setTimeout> | undefined
    let remaining = duration
    let startedAt = 0

    const toast = h('div', {
      class: `toast toast--${options.tone}`,
      role: options.tone === 'error' || options.tone === 'overdue' ? 'alert' : 'status',
    })

    const dismiss = () => {
      clearTimeout(timer)
      if (!toast.isConnected || toast.classList.contains('is-leaving')) return
      toast.classList.add('is-leaving')
      setTimeout(() => toast.remove(), 170)
    }

    const start = () => {
      startedAt = Date.now()
      timer = setTimeout(dismiss, remaining)
    }
    const pause = () => {
      clearTimeout(timer)
      remaining = Math.max(1500, remaining - (Date.now() - startedAt))
    }

    mount(
      toast,
      icon(ICONS[options.tone], 18),
      h(
        'div',
        { class: 'toast__content' },
        h('div', { class: 'toast__title' }, options.title),
        options.body && h('div', { class: 'toast__body' }, options.body),
        options.actions?.length &&
          h(
            'div',
            { class: 'toast__actions' },
            options.actions.map((action) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'link-btn',
                  onClick: () => {
                    dismiss()
                    action.onClick()
                  },
                },
                action.label,
              ),
            ),
          ),
      ),
      h(
        'button',
        { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss notification', onClick: dismiss },
        icon(X, 16),
      ),
    )

    // Pause while the user is reading or interacting with it.
    toast.addEventListener('mouseenter', pause)
    toast.addEventListener('mouseleave', start)
    toast.addEventListener('focusin', pause)
    toast.addEventListener('focusout', start)

    this.region.append(toast)
    const visible = this.region.querySelectorAll('.toast:not(.is-leaving)')
    if (visible.length > MAX_VISIBLE) visible[0].remove()
    start()
    return dismiss
  }
}
