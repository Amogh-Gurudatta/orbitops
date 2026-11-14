// Analytics metric catalogue: which rollup metrics can be studied and where their alarm limits sit.
// Limits come from the default alert rules, so a value coloured here is one that would alarm.
import type { Limits } from '../../charts/StripChart.tsx';
import { METRIC_META, type NumericMetric } from '../../realtime/metrics.ts';

export const ANALYTICS_METRICS = [
  'batSoc',
  'panelTempC',
  'obcTempC',
  'solarW',
  'busA',
  'rssiDbm',
  'attRateDps',
] as const satisfies readonly NumericMetric[];
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

export const DEFAULT_METRIC: AnalyticsMetric = 'panelTempC';

export const METRIC_LIMITS: Partial<Record<AnalyticsMetric, Limits>> = {
  batSoc: { warning: { lo: 0.2 } },
  panelTempC: { caution: { hi: 70 }, warning: { hi: 85 } },
  obcTempC: { caution: { hi: 55 } },
  rssiDbm: { caution: { lo: -125 } },
  attRateDps: { warning: { hi: 2 } },
};

export const isAnalyticsMetric = (value: string | null): value is AnalyticsMetric =>
  ANALYTICS_METRICS.includes(value as AnalyticsMetric);

export const metricLabel = (metric: AnalyticsMetric) =>
  `${METRIC_META[metric].label} (${METRIC_META[metric].unit})`;

export type Tone = 'normal' | 'caution' | 'warning';

/** Which alarm band a value falls in. Warning wins over caution. */
export function toneOf(value: number, limits: Limits | undefined): Tone {
  const { warning, caution } = limits ?? {};
  if (
    (warning?.hi !== undefined && value >= warning.hi) ||
    (warning?.lo !== undefined && value < warning.lo)
  )
    return 'warning';
  if (
    (caution?.hi !== undefined && value >= caution.hi) ||
    (caution?.lo !== undefined && value < caution.lo)
  )
    return 'caution';
  return 'normal';
}

export interface RangeOption {
  value: string;
  label: string;
  ms: number;
}
export const RANGES: readonly RangeOption[] = [
  { value: '6h', label: '6 H', ms: 6 * 3_600_000 },
  { value: '24h', label: '24 H', ms: 24 * 3_600_000 },
  { value: '3d', label: '3 D', ms: 72 * 3_600_000 },
];
export const BUCKETS_MIN = [5, 10, 30] as const;
