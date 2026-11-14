// Display limits mirroring the server's default alert rules (anomaly/domainRules.ts), so a readout turns amber
// or red at the same value that would raise the matching alert. Display only: alerts remain the source of truth.
import type { ReadoutState } from '../../ui/index.ts';

type Band = { caution: number; warning: number; direction: 'above' | 'below' };

const BANDS = {
  batSoc: { caution: 0.2, warning: 0.1, direction: 'below' },
  panelTempC: { caution: 70, warning: 85, direction: 'above' },
  obcTempC: { caution: 55, warning: 55, direction: 'above' },
  busA: { caution: 4, warning: 4, direction: 'above' },
  attRateDps: { caution: 2, warning: 2, direction: 'above' },
  rssiDbm: { caution: -125, warning: -125, direction: 'below' },
} as const satisfies Record<string, Band>;

export type LimitedMetric = keyof typeof BANDS;

/** Readout state for a metric value: nominal, caution or warning. Missing values are nominal (shown as a dash). */
export function limitState(
  metric: LimitedMetric,
  value: number | null | undefined,
): Extract<ReadoutState, 'nominal' | 'caution' | 'warning'> {
  if (value === null || value === undefined || Number.isNaN(value)) return 'nominal';
  const band: Band = BANDS[metric];
  const beyond = (limit: number) => (band.direction === 'above' ? value > limit : value < limit);
  if (beyond(band.warning) && band.warning !== band.caution) return 'warning';
  return beyond(band.caution) ? 'caution' : 'nominal';
}
