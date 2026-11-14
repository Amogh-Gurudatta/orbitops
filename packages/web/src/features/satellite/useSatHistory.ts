// History tier for the selected range. For ranges longer than LIVE it fetches history (refreshed every
// 30 s), installs it behind the live ring via telemetryStore.mergeHistory (which also sets the worker's
// seq watermark so already-persisted live events are dropped) and removes it again on LIVE / unmount.
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serverNow } from '../../realtime/clock.ts';
import { telemetryStore } from '../../realtime/telemetryStore.ts';
import { HISTORY_METRICS } from './chartSpecs.ts';
import { bandColumns, type BandColumns } from './chartSources.ts';
import {
  HISTORY_REFRESH_MS,
  historyQuery,
  historySource,
  type HistorySource,
  type RangeConfig,
} from './ranges.ts';
import { fetchBandedHistory, satelliteKeys } from './satelliteApi.ts';

export interface SatHistory {
  source: HistorySource;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: unknown;
  /** Rows in the fetched history response (0 for LIVE). */
  points: number;
  bands: Partial<Record<string, BandColumns | null>>;
  retry(): void;
}

const METRICS_KEY = HISTORY_METRICS.join(',');

export function useSatHistory(satId: number, range: RangeConfig, chartWidthPx: number): SatHistory {
  const source = historySource(range);
  const enabled = source !== 'live';

  // Drop the previous range's tier the moment the range or satellite changes, and on unmount.
  useEffect(() => {
    telemetryStore.clearHistory(satId);
    return () => telemetryStore.clearHistory(satId);
  }, [satId, range.id]);

  const query = useQuery({
    queryKey: satelliteKeys.history(satId, range.id, METRICS_KEY),
    enabled,
    gcTime: 0,
    refetchInterval: HISTORY_REFRESH_MS,
    queryFn: ({ signal }) => {
      const q = historyQuery(range, serverNow(), chartWidthPx)!;
      return fetchBandedHistory({ satId, metrics: HISTORY_METRICS, signal, ...q });
    },
  });

  const data = query.data;
  useEffect(() => {
    if (enabled && data) telemetryStore.mergeHistory(satId, data);
  }, [enabled, data, satId]);

  const bands = useMemo(() => {
    const out: Partial<Record<string, BandColumns | null>> = {};
    if (data && source === 'rollup') for (const m of HISTORY_METRICS) out[m] = bandColumns(data, m);
    return out;
  }, [data, source]);

  return {
    source,
    status: !enabled ? 'idle' : query.isError && !data ? 'error' : data ? 'ready' : 'loading',
    error: query.error,
    points: enabled ? (data?.t.length ?? 0) : 0,
    bands,
    retry: () => void query.refetch(),
  };
}
