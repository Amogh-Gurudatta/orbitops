// Fixed-bucket latency histogram. Mergeable across worker threads (counts are plain arrays on the wire),
// and constant-memory no matter how many samples are recorded.

const RESOLUTION_MS = 0.25;
const MAX_MS = 10_000;
const BUCKETS = Math.ceil(MAX_MS / RESOLUTION_MS) + 1;

/** Sparse form that is cheap to post between threads: [bucketIndex, count] pairs. */
export type HistogramSnapshot = [number, number][];

export interface LatencySummary {
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export class Histogram {
  private readonly counts = new Uint32Array(BUCKETS);
  private total = 0;
  private sum = 0;
  private max = 0;

  record(ms: number): void {
    const value = ms < 0 ? 0 : ms;
    const bucket = Math.min(BUCKETS - 1, Math.round(value / RESOLUTION_MS));
    this.counts[bucket]!++;
    this.total++;
    this.sum += value;
    if (value > this.max) this.max = value;
  }

  get count(): number {
    return this.total;
  }

  snapshot(): { buckets: HistogramSnapshot; sum: number; max: number } {
    const buckets: HistogramSnapshot = [];
    this.counts.forEach((count, index) => {
      if (count > 0) buckets.push([index, count]);
    });
    return { buckets, sum: this.sum, max: this.max };
  }

  merge(other: { buckets: HistogramSnapshot; sum: number; max: number }): void {
    for (const [index, count] of other.buckets) {
      this.counts[index]! += count;
      this.total += count;
    }
    this.sum += other.sum;
    this.max = Math.max(this.max, other.max);
  }

  percentile(p: number): number {
    if (this.total === 0) return 0;
    const target = Math.ceil((p / 100) * this.total);
    let seen = 0;
    for (let i = 0; i < BUCKETS; i++) {
      seen += this.counts[i]!;
      if (seen >= target) return i * RESOLUTION_MS;
    }
    return this.max;
  }

  summary(): LatencySummary {
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      count: this.total,
      meanMs: this.total === 0 ? 0 : round(this.sum / this.total),
      p50Ms: round(this.percentile(50)),
      p95Ms: round(this.percentile(95)),
      p99Ms: round(this.percentile(99)),
      maxMs: round(this.max),
    };
  }
}
