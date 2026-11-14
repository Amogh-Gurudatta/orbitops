// Per-satellite sequence tracking: duplicate / out-of-order dropping and the history watermark.
// Pure logic, used by the socket worker and unit-tested in isolation.

/** A seq this far behind the last one seen means the source restarted rather than reordered. */
export const RESTART_GAP = 1024;

export type Verdict = 'accept' | 'duplicate' | 'watermark';

export class SeqTracker {
  private readonly last = new Map<number, number>();
  private readonly watermark = new Map<number, number>();
  duplicates = 0;
  belowWatermark = 0;
  restarts = 0;
  accepted = 0;

  /** Live events with seq <= lastSeq are already covered by the history response. */
  setWatermark(satId: number, lastSeq: number): void {
    const current = this.watermark.get(satId);
    this.watermark.set(satId, current === undefined ? lastSeq : Math.max(current, lastSeq));
  }

  /** Delta path: strictly increasing seq per satellite, and above the history watermark. */
  check(satId: number, seq: number): Verdict {
    const last = this.last.get(satId);
    if (last !== undefined && seq < last - RESTART_GAP) {
      this.restarts++;
      this.last.delete(satId);
      this.watermark.delete(satId);
    }
    const floor = this.last.get(satId) ?? -1;
    if (seq <= floor) {
      this.duplicates++;
      return 'duplicate';
    }
    if (seq <= (this.watermark.get(satId) ?? -1)) {
      this.belowWatermark++;
      return 'watermark';
    }
    this.last.set(satId, seq);
    this.accepted++;
    return 'accept';
  }

  /**
   * Snapshot path: the server's current state is authoritative, so it always updates the
   * latest frame, but it only counts as a new *sample* when it is ahead of everything seen.
   */
  checkSnapshot(satId: number, seq: number): { isNewSample: boolean } {
    const last = this.last.get(satId) ?? -1;
    const mark = this.watermark.get(satId) ?? -1;
    const isNewSample = seq > last && seq > mark;
    this.last.set(satId, Math.max(last, seq));
    return { isNewSample };
  }

  lastSeq(satId: number): number | undefined {
    return this.last.get(satId);
  }
}
