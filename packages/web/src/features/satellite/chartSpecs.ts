// What each subsystem chart plots: metric, display unit, normal band and alarm limits.
// Limits and bands are in DISPLAY units (battery SoC is 0..1 on the wire and plotted as %).
import type { Limits } from '../../charts/StripChart.tsx';
import type { NumericMetric } from '../../realtime/metrics.ts';
import { METRIC_META } from '../../realtime/metrics.ts';

export interface ChartSpec {
  metric: NumericMetric;
  /** Legend mnemonic. */
  label: string;
  unit: string;
  decimals: number;
  /** Wire value -> display value multiplier. */
  factor: number;
  normalBand?: readonly [number, number];
  limits?: Limits;
}

const spec = (
  metric: NumericMetric,
  extra: Pick<ChartSpec, 'normalBand' | 'limits'> & Partial<Pick<ChartSpec, 'label'>> = {},
): ChartSpec => {
  const meta = METRIC_META[metric];
  return {
    metric,
    label: extra.label ?? meta.label,
    unit: meta.unit,
    decimals: meta.decimals,
    factor: meta.scale,
    normalBand: extra.normalBand,
    limits: extra.limits,
  };
};

export const CHART_SPECS = {
  batSoc: spec('batSoc', {
    normalBand: [30, 100],
    limits: { caution: { lo: 20 }, warning: { lo: 10 } },
  }),
  solarW: spec('solarW', { label: 'SA PWR' }),
  busA: spec('busA'),
  panelTempC: spec('panelTempC', { limits: { caution: { hi: 70 }, warning: { hi: 85 } } }),
  obcTempC: spec('obcTempC', { limits: { caution: { hi: 55 } } }),
  rssiDbm: spec('rssiDbm'),
  snrDb: spec('snrDb'),
  attRateDps: spec('attRateDps', { limits: { caution: { hi: 1 }, warning: { hi: 2 } } }),
} as const satisfies Record<string, ChartSpec>;

export type ChartKey = keyof typeof CHART_SPECS;

/** Every metric the detail page charts: one history request covers all of them. */
export const HISTORY_METRICS: readonly NumericMetric[] = Object.values(CHART_SPECS).map(
  (s) => s.metric,
);

export type LimitState = 'nominal' | 'caution' | 'warning';

/** Classifies a display-unit value against limits (warning wins over caution). */
export function limitState(value: number | null | undefined, limits?: Limits): LimitState {
  if (value === null || value === undefined || Number.isNaN(value) || !limits) return 'nominal';
  const { warning, caution } = limits;
  if (
    (warning?.hi !== undefined && value >= warning.hi) ||
    (warning?.lo !== undefined && value <= warning.lo)
  )
    return 'warning';
  if (
    (caution?.hi !== undefined && value >= caution.hi) ||
    (caution?.lo !== undefined && value <= caution.lo)
  )
    return 'caution';
  return 'nominal';
}
