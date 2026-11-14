// Stage 3: per-source duplicate detection. A recently-seen window (LRU of seq numbers) catches repeats;
// anything older than the window can no longer be verified and is treated as a duplicate to stay safe.
import { LRUCache } from 'lru-cache';
import { DEDUP_WINDOW } from '@orbitops/shared';

export type DedupVerdict = 'new' | 'duplicate';

export class SeqDeduplicator {
  private readonly seen: LRUCache<number, true>;
  private high = -1;

  constructor(private readonly window: number = DEDUP_WINDOW) {
    this.seen = new LRUCache({ max: window });
  }

  get highWatermark(): number {
    return this.high;
  }

  /** Records `seq` as seen and says whether it is a repeat. */
  classify(seq: number): DedupVerdict {
    if (this.seen.has(seq)) return 'duplicate';
    if (this.high >= 0 && seq < this.high - this.window) return 'duplicate';
    this.seen.set(seq, true);
    if (seq > this.high) this.high = seq;
    return 'new';
  }

  reset(): void {
    this.seen.clear();
    this.high = -1;
  }
}
