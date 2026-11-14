import { describe, expect, it } from 'vitest';
import { GREY_RAMP, TOKENS } from '../../charts/tokens.ts';
import { groupAggregates, labelStepMs, buildPieces, satAxisLabel, valueExtent } from './heatmap.ts';
import { METRIC_LIMITS, toneOf } from './metrics.ts';

describe('toneOf', () => {
  const limits = METRIC_LIMITS.panelTempC;
  it('classifies against caution / warning limits', () => {
    expect(toneOf(20, limits)).toBe('normal');
    expect(toneOf(70, limits)).toBe('caution');
    expect(toneOf(90, limits)).toBe('warning');
    expect(toneOf(-300, undefined)).toBe('normal');
    expect(toneOf(0.1, METRIC_LIMITS.batSoc)).toBe('warning');
  });
});

describe('buildPieces', () => {
  const pieces = buildPieces(METRIC_LIMITS.panelTempC, -10, 50);

  it('covers the whole real line without gaps or overlaps', () => {
    expect(pieces[0]!.gte).toBeUndefined();
    expect(pieces.at(-1)!.lt).toBeUndefined();
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.gte).toBe(pieces[i - 1]!.lt);
  });

  it('uses grey for the normal range and amber / red only beyond limits', () => {
    const colorAt = (v: number) =>
      pieces.find((p) => (p.gte === undefined || v >= p.gte) && (p.lt === undefined || v < p.lt))!
        .color;
    expect(GREY_RAMP).toContain(colorAt(-5));
    expect(GREY_RAMP).toContain(colorAt(49));
    expect(colorAt(75)).toBe(TOKENS.caution);
    expect(colorAt(86)).toBe(TOKENS.warning);
  });

  it('ramps dark to light across the data range', () => {
    const colorAt = (v: number) =>
      pieces.find((p) => (p.gte === undefined || v >= p.gte) && (p.lt === undefined || v < p.lt))!
        .color;
    expect(GREY_RAMP.indexOf(colorAt(-9) as (typeof GREY_RAMP)[number])).toBeLessThan(
      GREY_RAMP.indexOf(colorAt(49) as (typeof GREY_RAMP)[number]),
    );
  });

  it('colours low limits (battery) red below the threshold', () => {
    const p = buildPieces(METRIC_LIMITS.batSoc, 0.4, 0.95);
    expect(p[0]).toEqual({ lt: 0.2, color: TOKENS.warning });
  });

  it('stays purely grey for metrics without limits and survives flat data', () => {
    expect(buildPieces(undefined, 3, 9).every((p) => GREY_RAMP.includes(p.color as never))).toBe(
      true,
    );
    expect(buildPieces(undefined, 5, 5).length).toBeGreaterThan(0);
  });
});

describe('valueExtent', () => {
  it('ignores nulls and returns null for empty data', () => {
    expect(
      valueExtent([
        [null, 3],
        [7, null],
      ]),
    ).toEqual([3, 7]);
    expect(valueExtent([[null]])).toBeNull();
  });
});

describe('groupAggregates', () => {
  const heatmap = {
    satIds: [1, 2, 3],
    buckets: [0, 1],
    values: [
      [10, 20],
      [30, null],
      [90, 50],
    ],
  };
  const groupOf = (id: number) => (id === 3 ? ('weather' as const) : ('stations' as const));
  it('aggregates per group in taxonomy order', () => {
    const rows = groupAggregates(heatmap, groupOf, METRIC_LIMITS.panelTempC);
    expect(rows.map((r) => r.group)).toEqual(['stations', 'weather']);
    expect(rows[0]).toMatchObject({ sats: 2, min: 10, max: 30 });
    expect(rows[0]!.mean).toBeCloseTo(20);
    expect(rows[1]).toMatchObject({ sats: 1, max: 90, beyondLimit: 0.5 });
  });
});

describe('labels', () => {
  it('steps the time axis by range', () => {
    expect(labelStepMs(6 * 3_600_000)).toBe(3_600_000);
    expect(labelStepMs(72 * 3_600_000)).toBe(12 * 3_600_000);
  });
  it('shortens long satellite names', () => {
    expect(satAxisLabel(25544, 'ISS (ZARYA)')).toBe('25544 ISS (ZARYA)');
    expect(satAxisLabel(1, 'A VERY LONG SATELLITE NAME')).toBe('1 A VERY LONG S…');
  });
});
