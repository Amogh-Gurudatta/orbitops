import { describe, expect, it } from 'vitest';
import {
  chartHz,
  gapSeconds,
  historyQuery,
  historySource,
  rangeById,
  sourceLabel,
  windowSeconds,
} from './ranges.ts';

const NOW = 1_800_000_000_000;

describe('range model', () => {
  it('needs no history for LIVE', () => {
    expect(historyQuery(rangeById('live'), NOW, 800)).toBeNull();
    expect(sourceLabel(rangeById('live'))).toBe('LIVE');
  });

  it('uses raw telemetry up to two hours and rollups beyond', () => {
    expect(historySource(rangeById('15m'))).toBe('raw');
    expect(historySource(rangeById('1h'))).toBe('raw');
    expect(historySource(rangeById('6h'))).toBe('rollup');
    expect(sourceLabel(rangeById('1h'))).toBe('RAW');
    expect(sourceLabel(rangeById('24h'))).toBe('1-MIN ROLLUP');
  });

  it('queries [now - span, now] with maxPoints scaled to the chart width', () => {
    const q = historyQuery(rangeById('1h'), NOW, 600)!;
    expect(q).toEqual({ from: NOW - 3_600_000, to: NOW, maxPoints: 1200, bands: false });
    expect(historyQuery(rangeById('15m'), NOW, 50)!.maxPoints).toBe(400);
    expect(historyQuery(rangeById('15m'), NOW, 4000)!.maxPoints).toBe(2000);
  });

  it('asks rollup ranges for every minute bucket plus the min/max envelope', () => {
    const q = historyQuery(rangeById('24h'), NOW, 600)!;
    expect(q.bands).toBe(true);
    expect(q.maxPoints).toBe(1450);
    expect(historyQuery(rangeById('6h'), NOW, 600)!.maxPoints).toBe(370);
  });

  it('derives chart window, gap threshold and redraw rate per range', () => {
    expect(windowSeconds(rangeById('live'))).toBe(300);
    expect(windowSeconds(rangeById('24h'))).toBe(86_400);
    expect(gapSeconds(rangeById('live'))).toBe(5);
    expect(gapSeconds(rangeById('6h'))).toBeGreaterThan(60);
    expect(chartHz(rangeById('live'))).toBeGreaterThan(chartHz(rangeById('1h')));
  });

  it('falls back to LIVE for unknown ids', () => {
    expect(rangeById('nope').id).toBe('live');
  });
});

describe('history query timestamps', () => {
  it('rounds fractional clock readings to whole milliseconds', () => {
    const q = historyQuery(rangeById('6h'), NOW + 0.6, 600)!;
    expect(Number.isInteger(q.from)).toBe(true);
    expect(Number.isInteger(q.to)).toBe(true);
    expect(q.to - q.from).toBe(6 * 3_600_000);
  });
});
