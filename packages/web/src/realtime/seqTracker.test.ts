import { describe, expect, it } from 'vitest';
import { RESTART_GAP, SeqTracker } from './seqTracker.ts';

describe('SeqTracker', () => {
  it('accepts increasing seq and drops duplicates and out-of-order events', () => {
    const t = new SeqTracker();
    expect(t.check(1, 5)).toBe('accept');
    expect(t.check(1, 5)).toBe('duplicate');
    expect(t.check(1, 4)).toBe('duplicate');
    expect(t.check(1, 6)).toBe('accept');
    expect(t.duplicates).toBe(2);
    expect(t.accepted).toBe(2);
  });

  it('tracks satellites independently', () => {
    const t = new SeqTracker();
    t.check(1, 10);
    expect(t.check(2, 1)).toBe('accept');
  });

  it('drops live events at or below the history watermark', () => {
    const t = new SeqTracker();
    t.setWatermark(1, 100);
    expect(t.check(1, 99)).toBe('watermark');
    expect(t.check(1, 100)).toBe('watermark');
    expect(t.check(1, 101)).toBe('accept');
    expect(t.belowWatermark).toBe(2);
  });

  it('never lowers an existing watermark', () => {
    const t = new SeqTracker();
    t.setWatermark(1, 100);
    t.setWatermark(1, 50);
    expect(t.check(1, 80)).toBe('watermark');
  });

  it('treats a seq far below the last one as a source restart', () => {
    const t = new SeqTracker();
    t.check(1, 50_000);
    expect(t.check(1, 3)).toBe('accept');
    expect(t.restarts).toBe(1);
    expect(t.check(1, 4)).toBe('accept');
  });

  it('does not mistake small reordering for a restart', () => {
    const t = new SeqTracker();
    t.check(1, 5000);
    expect(t.check(1, 5000 - RESTART_GAP + 10)).toBe('duplicate');
  });

  it('snapshots update state but only count as a sample when ahead of everything seen', () => {
    const t = new SeqTracker();
    t.setWatermark(1, 100);
    expect(t.checkSnapshot(1, 100).isNewSample).toBe(false);
    expect(t.checkSnapshot(1, 120).isNewSample).toBe(true);
    expect(t.check(1, 120)).toBe('duplicate');
    expect(t.checkSnapshot(1, 120).isNewSample).toBe(false);
  });
});
