/**
 * The renderer's notion of "now" (FR-27). It follows the system clock; automated tests can shift it
 * through the main process so both processes agree on the same fake time.
 */
let offsetMs = 0

export const clock = {
  now: () => Date.now() + offsetMs,
  setOffset(ms: number) {
    offsetMs = ms
  },
}

/**
 * Calls `onTick` at the start of every minute and whenever the window becomes visible again, so
 * "today" and "overdue" stay current without polling the data (FR-29).
 */
export function startMinuteTicker(onTick: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    const msToNextMinute = 60_000 - (clock.now() % 60_000) + 25
    timer = setTimeout(() => {
      onTick()
      schedule()
    }, msToNextMinute)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') onTick()
  }
  schedule()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
