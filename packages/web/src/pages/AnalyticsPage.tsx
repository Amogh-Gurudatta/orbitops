// Analytics: historical analysis alongside live telemetry. Fleet heatmap, satellite study, group table.
import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useFleetStore } from '../realtime/fleetStore.ts';
import { METRIC_META } from '../realtime/metrics.ts';
import { analyticsKeys, fetchHeatmap } from '../features/analytics/analyticsApi.ts';
import { FleetHeatmap, HeatmapLegend } from '../features/analytics/FleetHeatmap.tsx';
import { FleetTable } from '../features/analytics/FleetTable.tsx';
import { valueExtent } from '../features/analytics/heatmap.ts';
import {
  ANALYTICS_METRICS,
  BUCKETS_MIN,
  METRIC_LIMITS,
  RANGES,
} from '../features/analytics/metrics.ts';
import { SatelliteStudy } from '../features/analytics/SatelliteStudy.tsx';
import { useAnalyticsParams } from '../features/analytics/useAnalyticsParams.ts';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  SegmentedControl,
  Select,
} from '../ui/index.ts';

const METRIC_OPTIONS = ANALYTICS_METRICS.map((m) => ({
  value: m,
  label: `${METRIC_META[m].label} (${METRIC_META[m].unit})`,
}));
const RANGE_OPTIONS = RANGES.map(({ value, label }) => ({ value, label }));
const BUCKET_OPTIONS = BUCKETS_MIN.map((m) => ({ value: String(m), label: `${m} MIN` }));
const REFRESH_MS = 60_000;

export function Component() {
  const { metric, range, bucketMin, satId, update } = useAnalyticsParams();
  const catalog = useFleetStore((s) => s.catalog);
  const selectedSatId = useFleetStore((s) => s.selectedSatId);
  const limits = METRIC_LIMITS[metric];

  const heatmap = useQuery({
    queryKey: analyticsKeys.heatmap(metric, range.ms, bucketMin),
    queryFn: ({ signal }) => fetchHeatmap(metric, range.ms, bucketMin, signal),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const extent = useMemo(
    () => (heatmap.data ? valueExtent(heatmap.data.values) : null),
    [heatmap.data],
  );

  const studySatId = satId ?? selectedSatId ?? heatmap.data?.satIds[0] ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule pb-1">
        <label className="flex items-center gap-1">
          <span className="mnemonic text-xs text-text-dim">METRIC</span>
          <Select
            aria-label="Metric"
            value={metric}
            options={METRIC_OPTIONS}
            className="w-32"
            onValueChange={(v) => update({ metric: v })}
          />
        </label>
        <div className="flex items-center gap-1">
          <span className="mnemonic text-xs text-text-dim">RANGE</span>
          <SegmentedControl
            aria-label="Range"
            value={range.value}
            options={RANGE_OPTIONS}
            onValueChange={(v) => update({ range: v })}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="mnemonic text-xs text-text-dim">BUCKET</span>
          <SegmentedControl
            aria-label="Bucket width"
            value={String(bucketMin)}
            options={BUCKET_OPTIONS}
            onValueChange={(v) => update({ bucket: v })}
          />
        </div>
        <HeatmapLegend limits={limits} metric={metric} extent={extent} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-1">
          <Panel
            title="FLEET HEATMAP"
            subtitle={`${METRIC_META[metric].label} · ${range.label} · ${bucketMin} MIN BUCKETS · CLICK A CELL TO STUDY`}
            flush
            className="h-[480px] xl:h-auto xl:min-h-0 xl:flex-1"
            bodyClassName="overflow-auto"
          >
            {heatmap.isPending ? (
              <LoadingState label="LOADING HEATMAP" />
            ) : heatmap.isError ? (
              <ErrorState error={heatmap.error} onRetry={() => void heatmap.refetch()} />
            ) : heatmap.data.buckets.length === 0 ? (
              <EmptyState title="NO ROLLUP DATA" detail="Rollups are written once a minute." />
            ) : (
              <FleetHeatmap
                data={heatmap.data}
                metric={metric}
                limits={limits}
                rangeMs={range.ms}
                bucketMin={bucketMin}
                catalog={catalog}
                selectedSatId={studySatId}
                onSelect={(id) => update({ sat: String(id) })}
              />
            )}
          </Panel>
          <div className="h-[216px] shrink-0">
            {heatmap.data ? (
              <FleetTable data={heatmap.data} metric={metric} limits={limits} catalog={catalog} />
            ) : (
              <Panel title="FLEET BY GROUP">
                <LoadingState label="LOADING" />
              </Panel>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-1">
          {studySatId === null ? (
            <Panel title="SATELLITE STUDY">
              <EmptyState title="NO SATELLITE" detail="Pick a cell in the heatmap." />
            </Panel>
          ) : (
            <SatelliteStudy
              satId={studySatId}
              satName={catalog[studySatId]?.name}
              metric={metric}
              rangeMs={range.ms}
            />
          )}
        </div>
      </div>
    </div>
  );
}
