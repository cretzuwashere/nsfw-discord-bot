import type { ResolvedTrack } from '../resolver/types.js';

export type EnqueueResult = { ok: true; position: number } | { ok: false; reason: 'full' };

/** Bounded FIFO queue of resolved tracks. Pure state — no I/O. */
export class PlaybackQueue {
  private items: ResolvedTrack[] = [];

  constructor(readonly maxSize: number) {}

  /** position is 1-based among upcoming tracks. */
  enqueue(track: ResolvedTrack): EnqueueResult {
    if (this.items.length >= this.maxSize) {
      return { ok: false, reason: 'full' };
    }
    this.items.push(track);
    return { ok: true, position: this.items.length };
  }

  /**
   * Append as many tracks as fit within the bound. Returns how many were
   * accepted and how many were dropped because the queue filled up.
   */
  enqueueMany(tracks: readonly ResolvedTrack[]): { accepted: number; rejected: number } {
    let accepted = 0;
    for (const track of tracks) {
      if (this.items.length >= this.maxSize) break;
      this.items.push(track);
      accepted++;
    }
    return { accepted, rejected: tracks.length - accepted };
  }

  dequeue(): ResolvedTrack | undefined {
    return this.items.shift();
  }

  peekAll(): readonly ResolvedTrack[] {
    return this.items;
  }

  /** Returns how many items were removed. */
  clear(): number {
    const removed = this.items.length;
    this.items = [];
    return removed;
  }

  get size(): number {
    return this.items.length;
  }
}
