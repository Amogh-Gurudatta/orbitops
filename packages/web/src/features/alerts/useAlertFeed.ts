// Alert list data: infinite REST pages (cursor = last openedAt) merged with live socket updates.
import { useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Alert } from '@orbitops/shared';
import { useAlertsStore } from '../../realtime/alertsStore.ts';
import { alertKeys, fetchAlertPage, PAGE_SIZE } from './alertsApi.ts';
import type { AlertFilters } from './filters.ts';
import { mergeAlerts } from './merge.ts';

/** Keeps fetching while the visible list is too short to scroll (client-side filters thin the pages). */
const MIN_ROWS = 40;

export function useAlertFeed(filters: AlertFilters) {
  const query = useInfiniteQuery({
    queryKey: alertKeys.list(filters),
    queryFn: ({ pageParam, signal }) => fetchAlertPage(filters, pageParam, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length >= PAGE_SIZE ? last.at(-1)!.openedAt : undefined),
  });
  const live = useAlertsStore((s) => s.alerts);

  const rows = useMemo(
    () => mergeAlerts(query.data?.pages.flat() ?? [], live, filters),
    [query.data, live, filters],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = query;
  useEffect(() => {
    if (rows.length < MIN_ROWS && hasNextPage && !isFetchingNextPage && !isError)
      void fetchNextPage();
  }, [rows.length, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  return { query, rows };
}

/** After an ack/resolve the cached pages are patched so rows evicted from the live store stay correct. */
export function usePatchAlertCache(): (alert: Alert) => void {
  const queryClient = useQueryClient();
  return (alert) => {
    useAlertsStore.getState().upsert(alert);
    queryClient.setQueriesData<InfiniteData<Alert[], number | undefined>>(
      { queryKey: alertKeys.listRoot },
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => page.map((row) => (row.id === alert.id ? alert : row))),
        },
    );
  };
}
