import { describe, expect, it } from 'vitest';
import { frame } from '../testing/factories.js';
import { TelemetryWriter, type InsertTarget, type Sample, type TelemetryDoc } from './writer.js';

class FakeCollection implements InsertTarget {
  batches: TelemetryDoc[][] = [];
  failNext = false;
  async insertMany(docs: TelemetryDoc[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('boom');
    }
    this.batches.push(docs);
  }
  get docs(): TelemetryDoc[] {
    return this.batches.flat();
  }
}

const sample = (seq: number, ts: number, extra: Partial<Sample> = {}): Sample => ({
  satId: 1,
  group: 'weather',
  seq,
  ts,
  frame: frame(),
  late: false,
  ...extra,
});

describe('TelemetryWriter', () => {
  it('downsamples to PERSIST_HZ per satellite', async () => {
    const target = new FakeCollection();
    const writer = new TelemetryWriter(target, { persistHz: 2 });
    for (let i = 0; i < 20; i++) writer.offer(sample(i, 1_000_000 + i * 100)); // 10 Hz for 2 s
    writer.offer(sample(0, 1_000_000, { satId: 2 }));
    await writer.stop();
    const sat1 = target.docs.filter((d) => d.meta.satId === 1);
    expect(sat1.map((d) => d.seq)).toEqual([0, 5, 10, 15]);
    expect(target.docs.some((d) => d.meta.satId === 2)).toBe(true);
  });

  it('writes the documented document shape', async () => {
    const target = new FakeCollection();
    const writer = new TelemetryWriter(target, { persistHz: 10 });
    writer.offer(sample(3, 5000));
    await writer.stop();
    const [doc] = target.docs;
    expect(doc).toMatchObject({ seq: 3, meta: { satId: 1, group: 'weather' }, mode: 'NOMINAL' });
    expect(doc?.ts).toEqual(new Date(5000));
    expect(doc && 'late' in doc).toBe(false);
  });

  it('flags late samples that fill a real hole and skips ones behind the last persisted point', async () => {
    const target = new FakeCollection();
    const writer = new TelemetryWriter(target, { persistHz: 2 });
    writer.offer(sample(10, 10_000));
    writer.offer(sample(5, 9_000, { late: true })); // behind the last persisted ts: skipped
    writer.offer(sample(20, 11_000, { late: true })); // ahead by >= interval: kept, flagged
    await writer.stop();
    expect(target.docs.map((d) => [d.seq, d.late])).toEqual([
      [10, undefined],
      [20, true],
    ]);
  });

  it('skips samples already persisted before a restart but keeps a restarted source', async () => {
    const target = new FakeCollection();
    const writer = new TelemetryWriter(target, { persistHz: 10 });
    writer.setBootMark(1, 100, 50_000);
    expect(writer.offer(sample(90, 40_000))).toBe(false); // replay of old data
    expect(writer.offer(sample(5, 60_000))).toBe(true); // seq reset but newer: new data
    await writer.stop();
    expect(target.docs).toHaveLength(1);
  });

  it('sheds the oldest samples when the queue is full and reports drops', async () => {
    const target = new FakeCollection();
    let dropped = 0;
    const writer = new TelemetryWriter(
      target,
      { persistHz: 10, maxQueue: 5, batchSize: 100 },
      { onDrop: (n) => (dropped += n) },
    );
    for (let i = 0; i < 8; i++) writer.offer(sample(i, i * 1000, { satId: i }));
    expect(writer.depth).toBe(5);
    expect(dropped).toBe(3);
    await writer.stop();
    expect(target.docs.map((d) => d.seq)).toEqual([3, 4, 5, 6, 7]);
  });

  it('flushes full batches immediately and reports timing', async () => {
    const target = new FakeCollection();
    const flushes: number[] = [];
    const writer = new TelemetryWriter(
      target,
      { persistHz: 10, batchSize: 3 },
      { onFlush: (_ms, docs) => flushes.push(docs) },
    );
    for (let i = 0; i < 7; i++) writer.offer(sample(i, i * 1000, { satId: i }));
    await writer.idle();
    expect(flushes).toEqual([3, 3]);
    await writer.stop();
    expect(flushes).toEqual([3, 3, 1]);
  });

  it('survives a failed insert and keeps writing', async () => {
    const target = new FakeCollection();
    const errors: number[] = [];
    const writer = new TelemetryWriter(
      target,
      { persistHz: 10, batchSize: 1 },
      { onError: (_e, docs) => errors.push(docs) },
    );
    target.failNext = true;
    writer.offer(sample(1, 1000, { satId: 1 }));
    writer.offer(sample(2, 2000, { satId: 2 }));
    await writer.stop();
    expect(errors).toEqual([1]);
    expect(target.docs.map((d) => d.seq)).toEqual([2]);
  });
});
