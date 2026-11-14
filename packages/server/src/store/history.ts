// Telemetry history reads: raw time-series points or minute rollups, returned as aligned columns
// (one shared time axis, one array per series) and downsampled with LTTB.
import { lttbIndices } from '@orbitops/shared';
import { nativeDb, TELEMETRY, TELEMETRY_1M } from '../db/index.js';
import { ROLLUP_METRICS, type RollupMetric } from '../jobs/rollups.js';

export const RAW_MAX_RANGE_MS = 2 * 3_600_000;

/** Metrics available as raw numeric series (everything numeric in the frame). */
export const RAW_METRICS = [
  'lat',
  'lon',
  'altKm',
  'velKms',
  'shadow',
  'solarW',
  'batSoc',
  'batV',
  'busA',
  'panelTempC',
  'obcTempC',
  'rssiDbm',
  'snrDb',
  'elevDeg',
  'attRateDps',
  'propKg',
] as const;
export type RawMetric = (typeof RAW_METRICS)[number];

/** Fraction of the minute spent in eclipse; only exists in rollups. */
export const ECLIPSE_FRAC = 'eclipseFrac';
export const ROLLUP_SERIES = [...ROLLUP_METRICS, ECLIPSE_FRAC] as readonly string[];

export interface Columns {
  t: number[];
  series: Record<string, (number | null)[]>;
  /** Highest seq among ALL persisted points in the range (before downsampling); -1 when there are none. */
  lastSeq: number;
}

/** Forward-fills nulls (back-fills leading ones) so LTTB sees a gap-free numeric series. */
function filled(values: (number | null)[]): number[] {
  const firstValue = values.find((v): v is number => v !== null) ?? 0;
  let last = firstValue;
  return values.map((v) => (last = v ?? last));
}

/**
 * Keeps at most `maxPoints` rows. Every column keeps the SAME rows (so the time axis stays shared): each
 * `shapeOf` series picks its own LTTB rows with an equal share of the budget, and the union is kept.
 */
export function downsampleColumns(columns: Columns, shapeOf: string[], maxPoints: number): Columns {
  const rows = columns.t.length;
  if (rows <= maxPoints || shapeOf.length === 0) return columns;
  const perSeries = Math.max(3, Math.floor(maxPoints / shapeOf.length));
  const keep = new Set<number>();
  for (const name of shapeOf) {
    const values = columns.series[name];
    if (!values) continue;
    for (const index of lttbIndices(columns.t, filled(values), perSeries)) keep.add(index);
  }
  const indices = [...keep].sort((a, b) => a - b);
  return {
    t: indices.map((i) => columns.t[i] as number),
    series: Object.fromEntries(
      Object.entries(columns.series).map(([name, values]) => [
        name,
        indices.map((i) => values[i] ?? null),
      ]),
    ),
    lastSeq: columns.lastSeq,
  };
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export async function readRaw(
  satId: number,
  fromMs: number,
  toMs: number,
  metrics: string[],
): Promise<Columns> {
  const projection: Record<string, 0 | 1> = { _id: 0, ts: 1, seq: 1 };
  for (const metric of metrics) projection[metric] = 1;
  const rows = await nativeDb()
    .collection(TELEMETRY)
    .aggregate<{ ts: Date; seq: number } & Record<string, unknown>>(
      [
        { $match: { 'meta.satId': satId, ts: { $gte: new Date(fromMs), $lte: new Date(toMs) } } },
        { $sort: { ts: 1 } },
        { $project: projection },
      ],
      { maxTimeMS: 15_000 },
    )
    .toArray();

  const columns: Columns = { t: [], series: {}, lastSeq: -1 };
  for (const metric of metrics) columns.series[metric] = [];
  for (const row of rows) {
    columns.t.push(row.ts.getTime());
    for (const metric of metrics) columns.series[metric]?.push(num(row[metric]));
    if (row.seq > columns.lastSeq) columns.lastSeq = row.seq;
  }
  return columns;
}

/** Rollup rows in [from, to]; `bands` adds `${metric}:min` / `${metric}:max` columns. */
export async function readRollups(
  satId: number,
  fromMs: number,
  toMs: number,
  metrics: string[],
  bands: boolean,
): Promise<Columns> {
  const projection: Record<string, unknown> = { _id: 0, bucket: 1, seqMax: 1 };
  for (const metric of metrics) {
    if (metric === ECLIPSE_FRAC) projection[metric] = 1;
    else {
      projection[`${metric}.avg`] = 1;
      if (bands) {
        projection[`${metric}.min`] = 1;
        projection[`${metric}.max`] = 1;
      }
    }
  }
  const rows = await nativeDb()
    .collection(TELEMETRY_1M)
    .find(
      { satId, bucket: { $gte: new Date(fromMs), $lte: new Date(toMs) } },
      { projection, sort: { bucket: 1 }, maxTimeMS: 15_000 },
    )
    .toArray();

  const columns: Columns = { t: [], series: {}, lastSeq: -1 };
  for (const metric of metrics) {
    columns.series[metric] = [];
    if (bands && metric !== ECLIPSE_FRAC) {
      columns.series[`${metric}:min`] = [];
      columns.series[`${metric}:max`] = [];
    }
  }
  for (const row of rows) {
    columns.t.push((row.bucket as Date).getTime());
    for (const metric of metrics) {
      if (metric === ECLIPSE_FRAC) {
        columns.series[metric]?.push(num(row[metric]));
        continue;
      }
      const stat = row[metric] as { avg?: unknown; min?: unknown; max?: unknown } | undefined;
      columns.series[metric]?.push(num(stat?.avg));
      if (bands) {
        columns.series[`${metric}:min`]?.push(num(stat?.min));
        columns.series[`${metric}:max`]?.push(num(stat?.max));
      }
    }
    const seq = num(row.seqMax);
    if (seq !== null && seq > columns.lastSeq) columns.lastSeq = seq;
  }
  return columns;
}

export const isRollupMetric = (metric: string): metric is RollupMetric | typeof ECLIPSE_FRAC =>
  ROLLUP_SERIES.includes(metric);
