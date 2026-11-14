// Replay data for the selected satellite: the whole window fetched once (chunked raw history) and
// converted to typed columns for fast lookups, plus coverage gaps and alert markers for the timeline.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { findGaps } from './coverage.ts';
import { fetchAlertMarkers, fetchReplayHistory, replayKeys } from './replayApi.ts';
import type { AlertMarker } from './Timeline.tsx';
import type { TimeSpan } from './timeline.ts';

/** Spacing above this counts as "no data" on the timeline (raw points are ~10 s apart after thinning). */
export const COVERAGE_GAP_MS = 2 * 60_000;

export interface ReplayColumns {
  /** Epoch ms ascending. */
  tMs: Float64Array;
  /** Wire values per metric, NaN for missing. */
  columns: Record<string, Float64Array>;
}

export function useReplayHistory(satId: number, span: TimeSpan) {
  const query = useQuery({
    queryKey: replayKeys.history(satId, span.from, span.to),
    queryFn: ({ signal }) => fetchReplayHistory(satId, span, signal),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });

  const data = useMemo<ReplayColumns | null>(() => {
    if (!query.data) return null;
    const { t, series } = query.data;
    const columns: Record<string, Float64Array> = {};
    for (const [metric, values] of Object.entries(series)) {
      columns[metric] = Float64Array.from(values, (v) => v ?? NaN);
    }
    return { tMs: Float64Array.from(t), columns };
  }, [query.data]);

  const gaps = useMemo(
    () => (data ? findGaps(data.tMs, span.from, span.to, COVERAGE_GAP_MS) : []),
    [data, span],
  );

  return { query, data, gaps };
}

export function useAlertMarkers(span: TimeSpan, selectedSatId: number): AlertMarker[] {
  const { data } = useQuery({
    queryKey: replayKeys.alerts,
    queryFn: fetchAlertMarkers,
    staleTime: 60_000,
  });
  return useMemo(
    () =>
      (data ?? [])
        .filter(
          (a) => a.openedAt >= span.from && a.openedAt <= span.to && a.severity !== 'ADVISORY',
        )
        .map((a) => ({
          t: a.openedAt,
          severity: a.severity as 'WARNING' | 'CAUTION',
          selected: a.satId === selectedSatId,
        })),
    [data, span, selectedSatId],
  );
}
