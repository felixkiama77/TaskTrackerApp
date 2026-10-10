import markUrl from '../../assets/brand/task-tracker-mark.svg'
import mark32Url from '../../assets/brand/task-tracker-mark-32.svg'
import type { OccurrenceStatus } from '../../domain/occurrences'
import { PRIORITY_LABEL, type CompletionClassification, type Priority } from '../../domain/types'
import { h, icon, type Child } from '../dom'
import type { IconNode } from 'lucide'
import { CircleCheck, Clock, Info, Sun, TriangleAlert } from '../icons'

/** The blue T app mark. Decorative wherever the app name is also present as text. */
export function brandMark(size: number, className: string, label?: string): HTMLImageElement {
  return h('img', {
    src: size <= 32 ? mark32Url : markUrl,
    width: size,
    height: size,
    class: className,
    alt: label ?? '',
  })
}

/** Status shown as text + icon, so it never relies on colour alone. Future items need no badge. */
export function statusBadge(status: OccurrenceStatus): HTMLElement | null {
  if (status === 'overdue')
    return h('span', { class: 'status-badge status-badge--overdue' }, icon(TriangleAlert, 13), 'Overdue')
  if (status === 'today')
    return h('span', { class: 'status-badge status-badge--today' }, icon(Sun, 13), 'Due today')
  return null
}

const CLASSIFICATION: Record<CompletionClassification, { label: string; icon: IconNode }> = {
  early: { label: 'Early', icon: CircleCheck },
  'on-time': { label: 'On time', icon: CircleCheck },
  overdue: { label: 'Late', icon: Clock },
  unknown: { label: 'Timing unknown', icon: Info },
}

export function classificationBadge(classification: CompletionClassification): HTMLElement {
  const { label, icon: node } = CLASSIFICATION[classification]
  const tone = classification === 'overdue' ? 'overdue' : classification
  return h('span', { class: `status-badge status-badge--${tone}` }, icon(node, 13), label)
}

export function priorityChip(priority: Priority): HTMLElement {
  return h(
    'span',
    { class: 'chip chip--priority', title: 'Priority', dataset: { priority } },
    h('span', { class: 'visually-hidden' }, 'Priority: '),
    PRIORITY_LABEL[priority],
  )
}

export function categoryChips(names: string[]): HTMLElement[] {
  return names.map((name) => h('span', { class: 'chip chip--category' }, name))
}

export function emptyState(options: {
  art: 'mark' | IconNode
  title: string
  text: string
  action?: Child
}): HTMLElement {
  return h(
    'div',
    { class: 'empty-state' },
    options.art === 'mark'
      ? brandMark(48, 'empty-state__mark')
      : h('div', { class: 'empty-state__art' }, icon(options.art, 24)),
    h('h2', null, options.title),
    h('p', null, options.text),
    options.action,
  )
}
