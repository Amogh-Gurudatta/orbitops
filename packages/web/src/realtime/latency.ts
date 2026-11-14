// Latency percentiles and NTP-style clock offset estimation. Pure helpers used by the worker.

export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  n: number;
}

/** Fixed-size window of the most recent latency samples (ms). */
export class LatencyWindow {
  private readonly samples: Float64Array;
  private count = 0;
  private next = 0;

  constructor(capacity: number) {
    this.samples = new Float64Array(capacity);
  }

  add(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % this.samples.length;
    if (this.count < this.samples.length) this.count++;
  }

  /** Percentiles over the current window, then resets it so each report covers a distinct interval. */
  drain(): Percentiles {
    const sorted = this.samples.slice(0, this.count).sort();
    const result = {
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      n: sorted.length,
    };
    this.count = 0;
    this.next = 0;
    return result;
  }
}

/** Nearest-rank quantile of an ascending-sorted array; 0 for an empty one. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return Math.round(sorted[rank]! * 10) / 10;
}

/**
 * Clock offset (server minus client) from TIME_SYNC round trips. Each sample assumes the server
 * stamped its time at the midpoint of the round trip; the sample with the smallest RTT is the
 * least distorted by asymmetric queueing, so it wins.
 */
export class ClockSync {
  private readonly best: { rtt: number; offset: number }[] = [];

  constructor(private readonly keep = 8) {}

  addSample(clientSend: number, serverTs: number, clientRecv: number): void {
    const rtt = clientRecv - clientSend;
    if (rtt < 0) return;
    this.best.push({ rtt, offset: serverTs - (clientSend + clientRecv) / 2 });
    if (this.best.length > this.keep) this.best.shift();
  }

  get offsetMs(): number {
    let chosen: { rtt: number; offset: number } | undefined;
    for (const s of this.best) if (!chosen || s.rtt < chosen.rtt) chosen = s;
    return chosen?.offset ?? 0;
  }
}
