// REST helpers for the analytics page: fleet heatmap, satellite summary and rollup history with bands.
import { api } from '../../api/client.ts';
import type { AnalyticsSummary, Heatmap, TelemetryHistory } from '../../api/types.ts';

export const analyticsKeys = {
  heatmap: (metric: string, rangeMs: number, bucketMin: number) =>
    ['analytics', 'heatmap', metric, rangeMs, bucketMin] as const,
  summary: (satId: number, rangeMs: number) => ['analytics', 'summary', satId, rangeMs] as const,
  study: (satId: number, metric: string, rangeMs: number) =>
    ['analytics', 'study', satId, metric, rangeMs] as const,
  scatter: (satId: number, rangeMs: number) => ['analytics', 'scatter', satId, rangeMs] as const,
};

export const fetchHeatmap = (
  metric: string,
  rangeMs: number,
  bucketMin: number,
  signal?: AbortSignal,
) => {
  const to = Date.now();
  return api.get<Heatmap>('/analytics/heatmap', {
    query: { metric, from: to - rangeMs, to, bucketMin },
    signal,
  });
};

export const fetchSummary = (satId: number, rangeMs: number, signal?: AbortSignal) => {
  const to = Date.now();
  return api.get<AnalyticsSummary>('/analytics/summary', {
    query: { satId, from: to - rangeMs, to },
    signal,
  });
};

/** Rollup history; `bands` adds `<metric>:min` / `<metric>:max` series. */
export const fetchRollupHistory = (
  satId: number,
  rangeMs: number,
  metrics: readonly string[],
  options: { bands?: boolean; maxPoints?: number; signal?: AbortSignal } = {},
) => {
  const to = Date.now();
  return api.get<TelemetryHistory>('/telemetry', {
    query: {
      satId,
      from: to - rangeMs,
      to,
      metrics: metrics.join(','),
      maxPoints: options.maxPoints ?? 1000,
      bands: options.bands ? 1 : 0,
    },
    signal: options.signal,
  });
};
