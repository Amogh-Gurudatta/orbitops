// Fixed-size window of recent samples with percentile queries (flush times, latency reports).
export class RollingWindow {
  private readonly samples: number[] = [];
  private next = 0;

  constructor(private readonly capacity: number = 256) {}

  add(value: number): void {
    if (this.samples.length < this.capacity) this.samples.push(value);
    else {
      this.samples[this.next] = value;
      this.next = (this.next + 1) % this.capacity;
    }
  }

  /** Nearest-rank percentile, p in 0..100; 0 when empty. */
  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[rank] as number;
  }

  get size(): number {
    return this.samples.length;
  }
}
