// Stage 4: per-source reorder buffer. Events are released strictly in seq order. A gap is tolerated for up
// to `holdMs` / `maxEvents`, after which the missing seqs are skipped (and counted). Events whose seq is at
// or below the released watermark can no longer be placed in order and are reported as late.
// A forward jump larger than `maxEvents` cannot be a reordering gap (the buffer could never fill it), so it
// starts a new epoch, e.g. a restarted simulator whose seq is derived from its boot time.
import { REORDER_HOLD_MS, REORDER_MAX_EVENTS, type TelemetryEvent } from '@orbitops/shared';

export interface ReorderResult {
  /** In-order events ready for live processing. */
  released: TelemetryEvent[];
  /** Events that arrived after their position was already released. */
  late: TelemetryEvent[];
  /** Number of missing seqs skipped over because the hold expired. */
  gaps: number;
  /** Events that arrived behind a later seq but were put back in order. */
  reordered: number;
}

interface Held {
  event: TelemetryEvent;
  receivedAt: number;
}

export class ReorderBuffer {
  private watermark: number | null = null;
  private maxSeen = -1;
  private held: Held[] = [];

  constructor(
    private readonly holdMs: number = REORDER_HOLD_MS,
    private readonly maxEvents: number = REORDER_MAX_EVENTS,
  ) {}

  get size(): number {
    return this.held.length;
  }

  push(event: TelemetryEvent, now: number): ReorderResult {
    const result: ReorderResult = { released: [], late: [], gaps: 0, reordered: 0 };
    if (this.watermark !== null && event.seq <= this.watermark) {
      result.late.push(event);
      return result;
    }
    // The first event of a source defines where its sequence starts.
    this.watermark ??= event.seq - 1;
    if (event.seq - this.watermark > this.maxEvents) {
      for (const { event: pending } of this.held.splice(0)) result.released.push(pending);
      this.watermark = event.seq - 1;
    }
    if (event.seq < this.maxSeen) result.reordered = 1;
    this.maxSeen = Math.max(this.maxSeen, event.seq);
    this.insertSorted({ event, receivedAt: now });
    this.release(now, result);
    return result;
  }

  /** Releases events whose hold time has expired; call periodically so a quiet source does not stall. */
  flush(now: number): ReorderResult {
    const result: ReorderResult = { released: [], late: [], gaps: 0, reordered: 0 };
    this.release(now, result);
    return result;
  }

  private insertSorted(entry: Held): void {
    let i = this.held.length;
    while (i > 0 && (this.held[i - 1] as Held).event.seq > entry.event.seq) i--;
    this.held.splice(i, 0, entry);
  }

  private release(now: number, result: ReorderResult): void {
    while (this.held.length > 0) {
      const head = this.held[0] as Held;
      const expected = (this.watermark as number) + 1;
      const contiguous = head.event.seq === expected;
      const expired = now - head.receivedAt >= this.holdMs || this.held.length > this.maxEvents;
      if (!contiguous && !expired) break;
      if (!contiguous) result.gaps += head.event.seq - expected;
      this.held.shift();
      this.watermark = head.event.seq;
      result.released.push(head.event);
    }
  }
}
