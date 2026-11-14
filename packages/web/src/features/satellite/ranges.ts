// Range picker model: which window the strip charts show and how history is requested for it.
// LIVE uses only the in-memory ring (~5 min); longer ranges fetch history that sits behind live data.

export type RangeId = 'live' | '15m' | '1h' | '6h' | '24h';

export interface RangeConfig {
  id: RangeId;
  label: string;
  spanMs: number;
}

/** Raw telemetry is served for spans up to this long; longer spans come from 1-minute rollups. */
export const RAW_MAX_SPAN_MS = 2 * 3_600_000;
export const LIVE_SPAN_MS = 5 * 60_000;
const MIN_MS = 60_000;

export const RANGES: readonly RangeConfig[] = [
  { id: 'live', label: 'LIVE 5M', spanMs: LIVE_SPAN_MS },
  { id: '15m', label: '15M', spanMs: 15 * MIN_MS },
  { id: '1h', label: '1H', spanMs: 60 * MIN_MS },
  { id: '6h', label: '6H', spanMs: 360 * MIN_MS },
  { id: '24h', label: '24H', spanMs: 1440 * MIN_MS },
];

export const DEFAULT_RANGE: RangeId = 'live';

export function rangeById(id: string): RangeConfig {
  return RANGES.find((r) => r.id === id) ?? RANGES[0]!;
}

export type HistorySource = 'live' | 'raw' | 'rollup';

export function historySource(range: RangeConfig): HistorySource {
  if (range.id === 'live') return 'live';
  return range.spanMs <= RAW_MAX_SPAN_MS ? 'raw' : 'rollup';
}

/** Panel subtitle label for the data tier behind the traces. */
export function sourceLabel(range: RangeConfig): string {
  const source = historySource(range);
  return source === 'live' ? 'LIVE' : source === 'raw' ? 'RAW' : '1-MIN ROLLUP';
}

export interface HistoryQuery {
  from: number;
  to: number;
  maxPoints: number;
  /** min/max envelope columns (rollups only). */
  bands: boolean;
}

const MAX_POINTS_FLOOR = 400;
const MAX_POINTS_CEIL = 2000;

/** Query params for a range ending at `now`, or null for LIVE (no history needed). */
export function historyQuery(
  range: RangeConfig,
  now: number,
  chartWidthPx: number,
): HistoryQuery | null {
  const source = historySource(range);
  if (source === 'live') return null;
  // The server rejects fractional timestamps; the offset-corrected clock can be fractional.
  const to = Math.round(now);
  const base = { from: to - range.spanMs, to, bands: source === 'rollup' };
  if (source === 'raw') {
    const maxPoints = Math.min(
      MAX_POINTS_CEIL,
      Math.max(MAX_POINTS_FLOOR, Math.round(chartWidthPx * 2)),
    );
    return { ...base, maxPoints };
  }
  // Rollups are one row per minute: ask for every bucket so nothing is thinned.
  return { ...base, maxPoints: Math.min(5000, Math.ceil(range.spanMs / MIN_MS) + 10) };
}

/** Chart window length in seconds (the reader trims to the newest N seconds). */
export function windowSeconds(range: RangeConfig): number {
  return range.spanMs / 1000;
}

/** Sample spacing that counts as a data gap and gets hatched, scaled to the tier's resolution. */
export function gapSeconds(range: RangeConfig): number {
  switch (historySource(range)) {
    case 'live':
      return 5;
    case 'raw':
      return range.spanMs <= 15 * MIN_MS ? 20 : 45;
    case 'rollup':
      return 180;
  }
}

/** Redraw rate for the range's charts: the live window moves fast, long ranges barely change. */
export function chartHz(range: RangeConfig): number {
  return range.id === 'live' ? 10 : 4;
}

/** How often an active historical range re-fetches so the history keeps up with "now". */
export const HISTORY_REFRESH_MS = 30_000;
