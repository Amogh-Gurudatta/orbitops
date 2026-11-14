// Analytics controls live in the URL (?metric=&range=&bucket=&sat=) so a view can be shared.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  BUCKETS_MIN,
  DEFAULT_METRIC,
  isAnalyticsMetric,
  RANGES,
  type AnalyticsMetric,
  type RangeOption,
} from './metrics.ts';

export interface AnalyticsParams {
  metric: AnalyticsMetric;
  range: RangeOption;
  bucketMin: number;
  satId: number | null;
}

export function useAnalyticsParams() {
  const [params, setParams] = useSearchParams();
  const value = useMemo<AnalyticsParams>(() => {
    const metric = params.get('metric');
    const bucket = Number(params.get('bucket'));
    const sat = params.get('sat');
    return {
      metric: isAnalyticsMetric(metric) ? metric : DEFAULT_METRIC,
      range: RANGES.find((r) => r.value === params.get('range')) ?? RANGES[0]!,
      bucketMin: (BUCKETS_MIN as readonly number[]).includes(bucket) ? bucket : 10,
      satId: sat !== null && /^\d{1,9}$/.test(sat) ? Number(sat) : null,
    };
  }, [params]);

  const update = (patch: Partial<Record<'metric' | 'range' | 'bucket' | 'sat', string>>) => {
    const next = new URLSearchParams(params);
    for (const [key, v] of Object.entries(patch)) next.set(key, v);
    setParams(next, { replace: true });
  };
  return { ...value, update };
}
