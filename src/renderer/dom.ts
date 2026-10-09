import { createElement, type IconNode } from 'lucide'

/**
 * A tiny typed helper for building DOM nodes, so views stay declarative without a framework.
 * Text is always inserted as text nodes (never as HTML), and inline `style` attributes are not
 * supported because the Content Security Policy blocks them.
 */
export type Child = Node | string | number | null | undefined | false | Child[]

export interface Props {
  class?: string | (string | false | null | undefined)[]
  dataset?: Record<string, string | undefined>
  [key: string]: unknown
}

/** Keys set as DOM properties rather than attributes (they reflect live state). */
const PROPERTY_KEYS = new Set(['value', 'checked', 'selected', 'indeterminate'])

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props) applyProps(el, props)
  append(el, ...children)
  return el
}

function applyProps(el: HTMLElement, props: Props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue
    if (key === 'class') {
      el.className = Array.isArray(value)
        ? value.filter(Boolean).join(' ')
        : typeof value === 'string'
          ? value
          : ''
    } else if (key === 'dataset') {
      for (const [name, v] of Object.entries(value as Record<string, string | undefined>)) {
        if (v !== undefined) el.dataset[name] = v
      }
    } else if (key === 'style') {
      throw new Error('Inline styles are not allowed; use a CSS class.')
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else if (PROPERTY_KEYS.has(key)) {
      Reflect.set(el, key, value)
    } else if (value === false) {
      continue
    } else if (value === true) {
      el.setAttribute(key, '')
    } else {
      el.setAttribute(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
  }
}

export function append(parent: Node, ...children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    if (Array.isArray(child)) append(parent, ...child)
    else parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)))
  }
}

/** Replaces all children of `el`. */
export function mount(el: Element, ...children: Child[]) {
  el.replaceChildren()
  append(el, ...children)
}

/** A decorative Lucide icon; meaning is always carried by accompanying text or an aria-label. */
export function icon(node: IconNode, size = 16, className?: string): SVGElement {
  return createElement(node, {
    width: size,
    height: size,
    'stroke-width': 2,
    class: className ? `icon ${className}` : 'icon',
    'aria-hidden': 'true',
    focusable: 'false',
  })
}

let idCounter = 0
/** A unique id for associating labels, hints and errors. */
export function uid(prefix: string): string {
  return `${prefix}-${++idCounter}`
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Resolves after `ms`, or immediately when reduced motion is preferred. */
export function motionDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : ms))
}
