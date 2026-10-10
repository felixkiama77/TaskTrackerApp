import { localDateOf, localeWeekStart, startOfMonth, type LocalDate, type Weekday } from '../domain/dates'
import { emptyAppData, type AppData } from '../domain/types'
import type { ListView, SortOrder } from '../domain/views'
import type { ImportStatus } from '../shared/api'
import { clock } from './clock'

/**
 * Renderer state. `data` is a read-only copy of what the main process holds (the single source of
 * truth, FR-35); `ui` is view state that only affects presentation.
 */
export type Route =
  | { name: 'list'; view: ListView }
  | { name: 'calendar' }
  | { name: 'completed' }
  | { name: 'categories' }
  | { name: 'settings' }

export interface UiState {
  route: Route
  sort: SortOrder
  /** Selected category ids; an occurrence matches if it has any of them. */
  categoryFilter: ReadonlySet<string>
  archiveOrder: 'newest' | 'oldest'
  calendarMonth: LocalDate
  calendarMode: 'month' | 'agenda'
}

const PREFS_KEY = 'task-tracker.view-preferences'

interface Prefs {
  sort?: SortOrder
  calendarMode?: UiState['calendarMode']
  archiveOrder?: UiState['archiveOrder']
}

/** View preferences are a per-device convenience; storage failures are ignored. */
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? (JSON.parse(raw) as Prefs) : {}
  } catch {
    return {}
  }
}

function savePrefs(ui: UiState) {
  try {
    const prefs: Prefs = { sort: ui.sort, calendarMode: ui.calendarMode, archiveOrder: ui.archiveOrder }
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Not important enough to report.
  }
}

/** A saved sort order; one saved before Priority replaced Difficulty becomes the matching Priority sort. */
function savedSort(value: unknown): SortOrder | null {
  if (typeof value !== 'object' || value === null) return null
  const { key, direction } = value as { key?: unknown; direction?: unknown }
  if (direction !== 'asc' && direction !== 'desc') return null
  if (key === 'due' || key === 'priority') return { key, direction }
  if (key === 'difficulty') return { key: 'priority', direction }
  return null
}

class AppState {
  data: AppData = emptyAppData()
  /** Suggested-task folder status from the main process (not saved data). */
  importStatus: ImportStatus | null = null
  ui: UiState
  private listeners = new Set<() => void>()

  constructor() {
    const prefs = loadPrefs()
    this.ui = {
      route: { name: 'list', view: 'all' },
      sort: savedSort(prefs.sort) ?? { key: 'due', direction: 'asc' },
      categoryFilter: new Set(),
      archiveOrder: prefs.archiveOrder === 'oldest' ? 'oldest' : 'newest',
      calendarMonth: startOfMonth(localDateOf(clock.now())),
      calendarMode: prefs.calendarMode === 'agenda' ? 'agenda' : 'month',
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setData(data: AppData) {
    this.data = data
    // A deleted category must not linger in the filter (FR-13).
    const known = new Set(data.categories.map((c) => c.id))
    const filter = [...this.ui.categoryFilter].filter((id) => known.has(id))
    if (filter.length !== this.ui.categoryFilter.size)
      this.ui = { ...this.ui, categoryFilter: new Set(filter) }
    this.emit()
  }

  setUi(patch: Partial<UiState>) {
    this.ui = { ...this.ui, ...patch }
    savePrefs(this.ui)
    this.emit()
  }

  setImportStatus(status: ImportStatus) {
    this.importStatus = status
    this.emit()
  }

  /** Re-render without changing anything (e.g. the clock moved on). */
  refresh() {
    this.emit()
  }

  weekStart(): Weekday {
    const setting = this.data.settings.weekStart
    return setting === 'locale' ? localeWeekStart(navigator.language) : setting
  }

  categoryName(id: string): string | undefined {
    return this.data.categories.find((c) => c.id === id)?.name
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

export const state = new AppState()
