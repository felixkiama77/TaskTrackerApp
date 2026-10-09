import { prefersReducedMotion } from '../dom'

/**
 * The subtle line around the window edge (FR-25, design spec §7): blue for reminders, red for
 * overdue. It pulses twice over ~1.2 s and stops; with reduced motion it is a steady outline for a
 * few seconds instead. Any click or key press dismisses it. It never accompanies an alert alone —
 * a toast and the native notification always carry the message.
 */
export type EdgeTone = 'reminder' | 'overdue'

const STATIC_MS = 3000

export class EdgeAlert {
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly el: HTMLElement) {
    el.className = 'edge-alert'
    el.setAttribute('aria-hidden', 'true')
    el.addEventListener('animationend', () => this.reset())
    const dismiss = () => this.reset()
    window.addEventListener('pointerdown', dismiss, { capture: true })
    window.addEventListener('keydown', dismiss, { capture: true })
  }

  flash(tone: EdgeTone) {
    const active = this.el.classList.contains('is-pulsing') || this.el.classList.contains('is-static')
    // Don't restart for a second alert of the same kind; overdue takes precedence over a reminder.
    if (active && (this.el.dataset.tone === tone || this.el.dataset.tone === 'overdue')) return
    this.reset()
    this.el.dataset.tone = tone
    if (prefersReducedMotion()) {
      this.el.classList.add('is-static')
      this.timer = setTimeout(() => this.reset(), STATIC_MS)
    } else {
      // Force a reflow so the animation restarts cleanly.
      void this.el.offsetWidth
      this.el.classList.add('is-pulsing')
    }
  }

  private reset() {
    clearTimeout(this.timer)
    this.el.classList.remove('is-pulsing', 'is-static')
  }
}
