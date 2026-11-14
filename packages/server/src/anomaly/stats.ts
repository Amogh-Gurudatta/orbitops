// Online statistics for the detectors: Welford mean/variance (with removal), a fixed-size
// sliding window built on it, a rate-of-change window, and an EWMA. All O(1) per sample and allocation-free.

/** Welford's algorithm. `remove` lets it serve as a sliding-window accumulator. */
export class RunningStats {
  count = 0;
  mean = 0;
  private m2 = 0;

  add(x: number): void {
    this.count += 1;
    const delta = x - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (x - this.mean);
  }

  /** Undo a previous `add(x)`. The caller guarantees x is currently part of the set. */
  remove(x: number): void {
    if (this.count <= 1) {
      this.reset();
      return;
    }
    this.count -= 1;
    const delta = x - this.mean;
    this.mean -= delta / this.count;
    this.m2 -= delta * (x - this.mean);
    if (this.m2 < 0) this.m2 = 0; // rounding can push it a hair below zero
  }

  reset(): void {
    this.count = 0;
    this.mean = 0;
    this.m2 = 0;
  }

  /** Sample variance (n - 1 denominator); 0 until two samples are in. */
  get variance(): number {
    return this.count < 2 ? 0 : this.m2 / (this.count - 1);
  }

  get std(): number {
    return Math.sqrt(this.variance);
  }
}

/** Removing values accumulates rounding error, so the accumulator is rebuilt this often. */
const REBUILD_EVERY = 4096;
const STD_FLOOR_ABS = 1e-9;
const STD_FLOOR_REL = 1e-4;

/** Mean / standard deviation / z-score over the last `size` samples (ring buffer). */
export class SlidingWindowStats {
  private readonly buffer: Float64Array;
  private readonly stats = new RunningStats();
  private head = 0;
  private slidesSinceRebuild = 0;

  constructor(readonly size: number) {
    this.buffer = new Float64Array(size);
  }

  push(x: number): void {
    if (this.isFull) this.stats.remove(this.buffer[this.head]!);
    this.buffer[this.head] = x;
    this.head = (this.head + 1) % this.size;
    this.stats.add(x);
    if (this.isFull && ++this.slidesSinceRebuild >= REBUILD_EVERY) this.rebuild();
  }

  get count(): number {
    return this.stats.count;
  }

  get isFull(): boolean {
    return this.stats.count === this.size;
  }

  get mean(): number {
    return this.stats.mean;
  }

  get std(): number {
    return this.stats.std;
  }

  /**
   * How many standard deviations x is from the window mean. A perfectly flat window has
   * std 0, so a tiny noise floor keeps the result finite (and JSON-safe).
   */
  zScore(x: number): number {
    const std = Math.max(this.stats.std, STD_FLOOR_ABS + STD_FLOOR_REL * Math.abs(this.stats.mean));
    return (x - this.stats.mean) / std;
  }

  private rebuild(): void {
    this.stats.reset();
    for (let i = 0; i < this.size; i++) this.stats.add(this.buffer[i]!);
    this.slidesSinceRebuild = 0;
  }
}

/** Per-second rate of change across the last `size` samples (ring buffer of value + time). */
export class RateWindow {
  private readonly values: Float64Array;
  private readonly times: Float64Array;
  private head = 0;
  private filled = 0;

  constructor(private readonly size: number) {
    this.values = new Float64Array(size);
    this.times = new Float64Array(size);
  }

  /**
   * Rate versus the sample `size` pushes ago (units/second, ts in ms), then records the new
   * sample. Null while warming up or if time did not advance.
   */
  rateThenPush(value: number, ts: number): number | null {
    let rate: number | null = null;
    if (this.filled === this.size) {
      const dtSeconds = (ts - this.times[this.head]!) / 1000;
      if (dtSeconds > 0) rate = (value - this.values[this.head]!) / dtSeconds;
    } else {
      this.filled += 1;
    }
    this.values[this.head] = value;
    this.times[this.head] = ts;
    this.head = (this.head + 1) % this.size;
    return rate;
  }
}

/** Exponentially weighted moving average; the first sample seeds the value. */
export class Ewma {
  private current: number | null = null;

  constructor(private readonly alpha: number) {}

  update(x: number): number {
    this.current = this.current === null ? x : this.alpha * x + (1 - this.alpha) * this.current;
    return this.current;
  }

  get value(): number | null {
    return this.current;
  }
}
