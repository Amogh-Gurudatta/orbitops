// ALARMS tab: filter bar, virtualized log, detail pane, bulk acknowledge and keyboard triage
// (J / K move, A acknowledges, R resolves).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useAlertsStore } from '../../realtime/alertsStore.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { Button, EmptyState, ErrorState, LoadingState, Panel, Tooltip } from '../../ui/index.ts';
import { alertKeys, fetchRules } from './alertsApi.ts';
import { AlertDetail } from './AlertDetail.tsx';
import { AlertFilterBar } from './AlertFilterBar.tsx';
import { AlertTable } from './AlertTable.tsx';
import { filtersToParams, parseFilters, type AlertFilters } from './filters.ts';
import { useAlertActions } from './useAlertActions.ts';
import { useAlertFeed } from './useAlertFeed.ts';

/** `g` then `a` / `r` are the global go-to shortcuts; ignore A / R right after a `g`. */
const GOTO_GRACE_MS = 1000;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function AlarmsView() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const catalog = useFleetStore((s) => s.catalog);
  const liveAlerts = useAlertsStore((s) => s.alerts);
  const { query, rows } = useAlertFeed(filters);
  const rules = useQuery({ queryKey: alertKeys.rules, queryFn: fetchRules, staleTime: 60_000 });
  const actions = useAlertActions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setFilters = (next: AlertFilters) => setParams(filtersToParams(next), { replace: true });
  const satLabel = useCallback(
    (satId: number) => `${catalog[satId]?.name ?? 'SAT'} ${satId}`,
    [catalog],
  );

  const selected = useMemo(
    () =>
      selectedId === null
        ? null
        : (rows.find((a) => a.id === selectedId) ??
          liveAlerts.find((a) => a.id === selectedId) ??
          null),
    [rows, liveAlerts, selectedId],
  );
  const unackedVisible = useMemo(() => rows.filter((a) => a.state === 'open'), [rows]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Keyboard triage. Re-bound whenever the list or selection changes; cheap and always current.
  useEffect(() => {
    let lastGoto = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'g') lastGoto = Date.now();
      const index = rows.findIndex((a) => a.id === selectedId);
      if (key === 'j' || key === 'k') {
        const next = rows[Math.min(rows.length - 1, Math.max(0, index + (key === 'j' ? 1 : -1)))];
        if (next) setSelectedId(next.id);
        e.preventDefault();
        return;
      }
      if ((key !== 'a' && key !== 'r') || !selected || !actions.canAct) return;
      if (Date.now() - lastGoto < GOTO_GRACE_MS) return;
      // Triage flow: move to the neighbouring row so repeated A presses work down the list.
      const neighbour = rows[index + 1] ?? rows[index - 1];
      if (key === 'a' && selected.state === 'open') void actions.ack(selected);
      else if (key === 'r' && selected.state !== 'resolved') void actions.resolve(selected);
      else return;
      if (neighbour && filters.state !== 'all') setSelectedId(neighbour.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selected, selectedId, actions, filters.state]);

  const bulkLabel = actions.progress
    ? `ACKING ${actions.progress.done}/${actions.progress.total}`
    : `ACK ALL VISIBLE (${unackedVisible.length})`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <AlertFilterBar key={params.get('satId') ?? ''} filters={filters} onChange={setFilters} />
        <div className="flex items-center gap-1">
          {actions.error && (
            <span role="alert" className="mnemonic text-xs text-warning">
              {actions.error.toUpperCase()}
            </span>
          )}
          <Tooltip
            content={
              actions.canAct
                ? 'Acknowledge every open alarm in this list'
                : 'OPERATOR AUTHORITY REQUIRED'
            }
          >
            <span className="inline-block">
              <Button
                size="sm"
                variant="primary"
                disabled={
                  !actions.canAct || unackedVisible.length === 0 || actions.progress !== null
                }
                onClick={() => void actions.ackMany(unackedVisible)}
              >
                {bulkLabel}
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="ALARM LOG"
          subtitle={`${rows.length}${hasNextPage ? '+' : ''} ROWS · NEWEST FIRST`}
          flush
          className="min-h-48"
        >
          {query.isPending ? (
            <LoadingState label="LOADING ALARM LOG" />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title="NO ALARMS MATCH" detail="Nothing in the log for these filters." />
          ) : (
            <AlertTable
              rows={rows}
              selectedId={selectedId}
              onSelect={setSelectedId}
              satLabel={satLabel}
              onEndReached={loadMore}
              loadingMore={isFetchingNextPage}
            />
          )}
        </Panel>
        <AlertDetail
          alert={selected}
          rule={rules.data?.find((r) => r.id === selected?.ruleId)}
          satName={selected ? catalog[selected.satId]?.name : undefined}
          canAct={actions.canAct}
          onAck={(a) => void actions.ack(a)}
          onResolve={(a) => void actions.resolve(a)}
        />
      </div>
    </div>
  );
}
