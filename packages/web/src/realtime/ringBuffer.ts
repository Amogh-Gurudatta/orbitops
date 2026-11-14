// Fixed-capacity ring buffer of time-aligned rows: one time column plus N value columns, all Float64Array.
// Storage is "mirrored" (every row is written at i and i + capacity) so the oldest-to-newest window is
// always one contiguous slice: reading for uPlot is a zero-copy subarray, never a re-ordering copy.

export interface RingView {
  readonly length: number;
  readonly t: Float64Array;
  readonly columns: readonly Float64Array[];
}

export class RingBuffer {
  readonly capacity: number;
  readonly columnCount: number;
  private readonly time: Float64Array;
  private readonly data: Float64Array[];
  /** Index of the oldest row. */
  private start = 0;
  private size = 0;
  /** Bumped on every mutation; lets readers skip work when nothing changed. */
  version = 0;
  private cached: { version: number; view: RingView } | null = null;

  constructor(capacity: number, columnCount = 1) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    this.capacity = capacity;
    this.columnCount = columnCount;
    this.time = new Float64Array(capacity * 2);
    this.data = Array.from({ length: columnCount }, () => new Float64Array(capacity * 2));
  }

  get length(): number {
    return this.size;
  }

  firstTime(): number | undefined {
    return this.size === 0 ? undefined : this.time[this.start];
  }

  lastTime(): number | undefined {
    return this.size === 0 ? undefined : this.time[this.start + this.size - 1];
  }

  /** Appends one row; `values[c]` is column c. Overwrites the oldest row when full. */
  push(t: number, values: ArrayLike<number>): void {
    const slot = (this.start + this.size) % this.capacity;
    this.time[slot] = t;
    this.time[slot + this.capacity] = t;
    for (let c = 0; c < this.columnCount; c++) {
      const v = values[c] ?? NaN;
      this.data[c]![slot] = v;
      this.data[c]![slot + this.capacity] = v;
    }
    if (this.size < this.capacity) this.size++;
    else this.start = (this.start + 1) % this.capacity;
    this.version++;
  }

  /**
   * Appends `n` rows from a column-major block (values[c * n + i]), the layout worker chunks use.
   * Only the last `capacity` rows are kept when n exceeds capacity.
   */
  pushMany(t: ArrayLike<number>, values: ArrayLike<number>, n = t.length): void {
    const skip = Math.max(0, n - this.capacity);
    const row = new Array<number>(this.columnCount);
    for (let i = skip; i < n; i++) {
      for (let c = 0; c < this.columnCount; c++) row[c] = values[c * n + i]!;
      this.push(t[i]!, row);
    }
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
    this.version++;
  }

  /**
   * Oldest-to-newest views of every column. The returned object is cached until the buffer changes,
   * so repeated reads in a frame allocate nothing. Views alias internal storage: do not mutate.
   */
  toArrays(): RingView {
    if (this.cached?.version === this.version) return this.cached.view;
    const end = this.start + this.size;
    const view: RingView = {
      length: this.size,
      t: this.time.subarray(this.start, end),
      columns: this.data.map((col) => col.subarray(this.start, end)),
    };
    this.cached = { version: this.version, view };
    return view;
  }
}
