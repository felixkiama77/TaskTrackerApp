import type { Track } from './catalog'

/**
 * Background-music rotation. In order, it loops through the tracks. Shuffled, it plays every track
 * once per round in random order, reshuffles for the next round, and never plays the same track
 * twice in a row across rounds.
 */
export class Playlist {
  private order: number[] = []
  private position = -1

  constructor(
    private tracks: Track[],
    private shuffle: boolean,
    private readonly random: () => number = Math.random,
  ) {}

  get size() {
    return this.tracks.length
  }

  current(): Track | null {
    const index = this.order[this.position]
    return index === undefined ? null : (this.tracks[index] ?? null)
  }

  /** Advances to and returns the next track (null when there are none). */
  next(): Track | null {
    if (this.tracks.length === 0) return null
    if (this.position + 1 >= this.order.length) this.newRound()
    else this.position++
    return this.current()
  }

  /** Replaces the tracks (e.g. the user added or removed some); keeps the current one if it remains. */
  setTracks(tracks: Track[]) {
    const current = this.current()
    this.tracks = tracks
    const index = current ? tracks.findIndex((t) => t.url === current.url) : -1
    this.order = index >= 0 ? [index] : []
    this.position = index >= 0 ? 0 : -1
  }

  setShuffle(shuffle: boolean) {
    if (shuffle === this.shuffle) return
    this.shuffle = shuffle
    // Keep the current track; the new ordering applies from the next round.
    const current = this.order[this.position]
    this.order = current === undefined ? [] : [current]
    this.position = current === undefined ? -1 : 0
  }

  private newRound() {
    const previous = this.order[this.position]
    const indexes = this.tracks.map((_, i) => i)
    if (this.shuffle) {
      for (let i = indexes.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1))
        ;[indexes[i], indexes[j]] = [indexes[j], indexes[i]]
      }
      // Avoid repeating the last track of the previous round.
      if (indexes.length > 1 && indexes[0] === previous) [indexes[0], indexes[1]] = [indexes[1], indexes[0]]
    } else if (previous !== undefined) {
      // In order: continue after the track that was playing.
      const start = (previous + 1) % indexes.length
      indexes.push(...indexes.splice(0, start))
    }
    this.order = indexes
    this.position = 0
  }
}
