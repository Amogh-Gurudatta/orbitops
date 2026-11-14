// Pure helpers behind the fleet heatmap: colour pieces (grey ramp for normal, amber/red only beyond the
// metric's limits), axis labelling and per-group aggregates for the fleet table.
import { SAT_GROUPS, type SatGroup } from '@orbitops/shared';
import type { Limits } from '../../charts/StripChart.tsx';
import { GREY_RAMP, TOKENS } from '../../charts/tokens.ts';
import type { Heatmap } from '../../api/types.ts';
import { toneOf } from './metrics.ts';

export interface Piece {
  gte?: number;
  lt?: number;
  color: string;
}

/**
 * Piecewise colour map. The normal range (between the metric's limits, clipped to the data) is split
 * into one bin per grey-ramp step; anything beyond a limit is amber (caution) or red (warning).
 */
export function buildPieces(limits: Limits | undefined, dataMin: number, dataMax: number): Piece[] {
  const lows = [limits?.warning?.lo, limits?.caution?.lo].filter((v) => v !== undefined);
  const highs = [limits?.caution?.hi, limits?.warning?.hi].filter((v) => v !== undefined);
  const rampLo = Math.max(dataMin, ...lows);
  const rampHi = Math.min(dataMax, ...highs);
  const span = rampHi - rampLo;
  const ramp =
    span > 0
      ? Array.from(
          { length: GREY_RAMP.length - 1 },
          (_, i) => rampLo + (span * (i + 1)) / GREY_RAMP.length,
        )
      : [];

  const cuts = [
    ...new Set(
      [
        limits?.warning?.lo,
        limits?.caution?.lo,
        ...ramp,
        limits?.caution?.hi,
        limits?.warning?.hi,
      ].filter((v): v is number => v !== undefined),
    ),
  ].sort((a, b) => a - b);

  const bounds = [-Infinity, ...cuts, Infinity];
  const pieces: Piece[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const lower = bounds[i]!;
    const upper = bounds[i + 1]!;
    const probe = Number.isFinite(lower) ? lower : upper - 1;
    const tone = toneOf(probe, limits);
    const rampStep = ramp.filter((edge) => edge <= probe).length;
    const color =
      tone === 'warning'
        ? TOKENS.warning
        : tone === 'caution'
          ? TOKENS.caution
          : GREY_RAMP[Math.min(rampStep, GREY_RAMP.length - 1)]!;
    pieces.push({
      ...(Number.isFinite(lower) ? { gte: lower } : {}),
      ...(Number.isFinite(upper) ? { lt: upper } : {}),
      color,
    });
  }
  return pieces;
}

/** Min / max over all non-null cells, or null when the heatmap holds no data. */
export function valueExtent(
  values: readonly (readonly (number | null)[])[],
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const row of values)
    for (const v of row)
      if (v !== null) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
  return min <= max ? [min, max] : null;
}

/** x-axis label cadence: one label per hour for 6 h, per 3 h for 24 h, per 12 h for 3 d. */
export function labelStepMs(rangeMs: number): number {
  const hour = 3_600_000;
  return rangeMs <= 6 * hour ? hour : rangeMs <= 24 * hour ? 3 * hour : 12 * hour;
}

export interface GroupAggregate {
  group: SatGroup;
  sats: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Share of populated cells beyond a caution/warning limit, 0..1. */
  beyondLimit: number | null;
}

/** Mean / min / max per satellite group across every populated cell of the heatmap. */
export function groupAggregates(
  heatmap: Heatmap,
  groupOf: (satId: number) => SatGroup | undefined,
  limits: Limits | undefined,
): GroupAggregate[] {
  type Acc = { sats: number; sum: number; n: number; min: number; max: number; beyond: number };
  const acc = new Map<SatGroup, Acc>();
  heatmap.satIds.forEach((satId, row) => {
    const group = groupOf(satId);
    if (!group) return;
    const a = acc.get(group) ?? { sats: 0, sum: 0, n: 0, min: Infinity, max: -Infinity, beyond: 0 };
    a.sats++;
    for (const v of heatmap.values[row] ?? []) {
      if (v === null) continue;
      a.sum += v;
      a.n++;
      a.min = Math.min(a.min, v);
      a.max = Math.max(a.max, v);
      if (toneOf(v, limits) !== 'normal') a.beyond++;
    }
    acc.set(group, a);
  });
  return SAT_GROUPS.filter((g) => acc.has(g)).map((group) => {
    const a = acc.get(group)!;
    return {
      group,
      sats: a.sats,
      mean: a.n > 0 ? a.sum / a.n : null,
      min: a.n > 0 ? a.min : null,
      max: a.n > 0 ? a.max : null,
      beyondLimit: a.n > 0 ? a.beyond / a.n : null,
    };
  });
}

/** `25544 ISS (ZARYA)` shortened to fit the heatmap's label gutter. */
export function satAxisLabel(satId: number, name: string | undefined, maxName = 14): string {
  const short = name ? (name.length > maxName ? `${name.slice(0, maxName - 1)}…` : name) : '';
  return `${satId} ${short}`.trim();
}
