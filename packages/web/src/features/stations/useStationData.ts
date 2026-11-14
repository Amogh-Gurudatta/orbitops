// Data hooks for the Ground Stations page: fleet-wide pass predictions (one request per satellite, covering all
// stations) and the live "satellites in view" count per station computed from client-side propagation.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { fetchPasses, queryKeys } from '../../api/endpoints.ts';
import type { GroundStation, Pass } from '../../api/types.ts';
import { serverNow } from '../../realtime/clock.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { FleetPropagator, visibleCounts } from '../globe/orbit.ts';

export const PASS_HOURS = 12;

export interface FleetPasses {
  passes: Pass[];
  /** Satellites whose pass list has arrived (success or failure). */
  settled: number;
  total: number;
  failed: number;
}

/**
 * GET /passes needs a satellite id, so the fleet is fetched one request per satellite (browsers cap parallel
 * requests per host, and the server caches per satellite for the hour). Results stream in as they arrive.
 */
export function useFleetPasses(): FleetPasses {
  const catalog = useFleetStore((s) => s.catalog);
  const satIds = useMemo(() => Object.keys(catalog).map(Number), [catalog]);
  const combine = useCallback(
    (results: { data?: Pass[]; isPending: boolean; isError: boolean }[]): FleetPasses => ({
      passes: results.flatMap((r) => r.data ?? []),
      settled: results.filter((r) => !r.isPending).length,
      total: results.length,
      failed: results.filter((r) => r.isError).length,
    }),
    [],
  );
  return useQueries({
    queries: satIds.map((satId) => ({
      queryKey: queryKeys.passes(satId, PASS_HOURS),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchPasses(satId, PASS_HOURS, undefined, signal),
      staleTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    })),
    combine,
  });
}

/** Seconds-resolution clock for countdowns and "now" lines. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const IN_VIEW_REFRESH_MS = 2000;

/** Satellites currently above each station's minimum elevation, refreshed every 2 s. */
export function useInViewCounts(
  stations: readonly GroundStation[] | undefined,
): Map<string, number> {
  const catalog = useFleetStore((s) => s.catalog);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!stations || stations.length === 0) return;
    const propagator = new FleetPropagator();
    propagator.sync(catalog);
    const update = () => setCounts(visibleCounts(propagator.allSatrecs(), stations, serverNow()));
    update();
    const id = setInterval(update, IN_VIEW_REFRESH_MS);
    return () => clearInterval(id);
  }, [stations, catalog]);

  return counts;
}
