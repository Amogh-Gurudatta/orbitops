// Catalogue of numeric telemetry metrics: stable column order (shared by worker and stores), labels and units.
import { TelemetryFrame, type TelemetryMetric } from '@orbitops/shared';

export type NumericMetric = Exclude<TelemetryMetric, 'stationId' | 'mode'>;

/** Column order used by sample chunks and ring buffers. Never reorder without updating both ends. */
export const NUMERIC_METRICS = [
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
] as const satisfies readonly NumericMetric[];

export const METRIC_COUNT = NUMERIC_METRICS.length;

const COLUMN_INDEX = new Map<string, number>(NUMERIC_METRICS.map((m, i) => [m, i]));

/** Column index of a metric in sample chunks, or -1 for non-numeric metrics. */
export function metricColumn(metric: string): number {
  return COLUMN_INDEX.get(metric) ?? -1;
}

export interface MetricMeta {
  /** Mnemonic shown in caps (fixed-position labels). */
  label: string;
  unit: string;
  decimals: number;
  /** Multiplier applied for display (battery SoC is 0..1 on the wire, shown as %). */
  scale: number;
}

export const METRIC_META: Record<NumericMetric, MetricMeta> = {
  lat: { label: 'LAT', unit: 'deg', decimals: 2, scale: 1 },
  lon: { label: 'LON', unit: 'deg', decimals: 2, scale: 1 },
  altKm: { label: 'ALT', unit: 'km', decimals: 1, scale: 1 },
  velKms: { label: 'VEL', unit: 'km/s', decimals: 2, scale: 1 },
  shadow: { label: 'ECL', unit: '%', decimals: 0, scale: 100 },
  solarW: { label: 'SA PWR', unit: 'W', decimals: 1, scale: 1 },
  batSoc: { label: 'BATT SOC', unit: '%', decimals: 1, scale: 100 },
  batV: { label: 'BATT V', unit: 'V', decimals: 2, scale: 1 },
  busA: { label: 'BUS CUR', unit: 'A', decimals: 2, scale: 1 },
  panelTempC: { label: 'PNL T', unit: '°C', decimals: 1, scale: 1 },
  obcTempC: { label: 'OBC T', unit: '°C', decimals: 1, scale: 1 },
  rssiDbm: { label: 'RSSI', unit: 'dBm', decimals: 1, scale: 1 },
  snrDb: { label: 'SNR', unit: 'dB', decimals: 1, scale: 1 },
  elevDeg: { label: 'ELEV', unit: 'deg', decimals: 1, scale: 1 },
  attRateDps: { label: 'ATT RATE', unit: '°/s', decimals: 2, scale: 1 },
  propKg: { label: 'PROP', unit: 'kg', decimals: 2, scale: 1 },
};

/** Formats a raw wire value for display; null/NaN render as the no-data dash. */
export function formatMetric(metric: NumericMetric, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const meta = METRIC_META[metric];
  return (value * meta.scale).toFixed(meta.decimals);
}

export function isNumericMetric(metric: string): metric is NumericMetric {
  return COLUMN_INDEX.has(metric);
}

/** Pulls the numeric metric values out of a (possibly partial) frame, NaN for missing/null. */
export function frameToRow(frame: Partial<TelemetryFrame>, out: Float64Array | number[]): void {
  for (let c = 0; c < METRIC_COUNT; c++) {
    const key = NUMERIC_METRICS[c]!;
    const v = frame[key];
    out[c] = typeof v === 'number' ? v : NaN;
  }
}
