// Satellite study: the selected satellite's metric over the range (history + baseline + live tail),
// summary readouts, and the battery-vs-eclipse scatter.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useLatest } from '../../realtime/useRealtime.ts';
import { METRIC_META, type NumericMetric } from '../../realtime/metrics.ts';
import {
  ErrorState,
  LoadingState,
  Panel,
  Readout,
  Tag,
  type ReadoutState,
} from '../../ui/index.ts';
import { analyticsKeys, fetchRollupHistory, fetchSummary } from './analyticsApi.ts';
import { EclipseScatter, scatterPoints } from './EclipseScatter.tsx';
import { METRIC_LIMITS, toneOf, type AnalyticsMetric } from './metrics.ts';
import { StudyChart } from './StudyChart.tsx';

const REFRESH_MS = 60_000;

export interface SatelliteStudyProps {
  satId: number;
  satName: string | undefined;
  metric: AnalyticsMetric;
  rangeMs: number;
}

function LiveReadout({ satId, metric }: { satId: number; metric: AnalyticsMetric }) {
  const meta = METRIC_META[metric];
  const live = useLatest(satId, [metric as NumericMetric], 2);
  const raw = live[metric as keyof typeof live] as number | null | undefined;
  const tone = raw === null || raw === undefined ? 'normal' : toneOf(raw, METRIC_LIMITS[metric]);
  return (
    <Readout
      label="LIVE NOW"
      value={raw === null || raw === undefined ? null : raw * meta.scale}
      unit={meta.unit}
      decimals={meta.decimals}
      state={(tone === 'normal' ? 'nominal' : tone) satisfies ReadoutState}
    />
  );
}

export function SatelliteStudy({ satId, satName, metric, rangeMs }: SatelliteStudyProps) {
  const meta = METRIC_META[metric];
  const summary = useQuery({
    queryKey: analyticsKeys.summary(satId, rangeMs),
    queryFn: ({ signal }) => fetchSummary(satId, rangeMs, signal),
    refetchInterval: REFRESH_MS,
  });
  const study = useQuery({
    queryKey: analyticsKeys.study(satId, metric, rangeMs),
    queryFn: ({ signal }) => fetchRollupHistory(satId, rangeMs, [metric], { bands: true, signal }),
    refetchInterval: REFRESH_MS,
  });
  const scatter = useQuery({
    queryKey: analyticsKeys.scatter(satId, rangeMs),
    queryFn: ({ signal }) =>
      fetchRollupHistory(satId, rangeMs, ['eclipseFrac', 'batSoc'], { maxPoints: 2000, signal }),
    refetchInterval: REFRESH_MS,
  });
  const scatterData = useMemo(
    () => (scatter.data ? scatterPoints(scatter.data) : null),
    [scatter.data],
  );

  const stats = summary.data?.metrics[metric];
  const scaled = (v: number | null | undefined) =>
    v === null || v === undefined ? null : v * meta.scale;

  return (
    <>
      <Panel
        title="SATELLITE STUDY"
        subtitle={
          <>
            <Link to={`/sat/${satId}`} className="text-text-2 hover:underline">
              {satName ?? 'SAT'} {satId}
            </Link>{' '}
            · {meta.label}
          </>
        }
        controls={<Tag>LIVE TAIL 5 MIN</Tag>}
        flush
        className="min-h-[400px] flex-[3]"
        bodyClassName="flex min-h-0 flex-col"
      >
        <div className="relative min-h-40 flex-1 p-1">
          {study.isError ? (
            <ErrorState error={study.error} onRetry={() => void study.refetch()} />
          ) : (
            <StudyChart
              satId={satId}
              metric={metric}
              rangeMs={rangeMs}
              history={study.data}
              baseline={summary.data?.baseline[metric]}
            />
          )}
          {study.isPending && (
            <div className="absolute inset-0 bg-panel">
              <LoadingState label="LOADING HISTORY" />
            </div>
          )}
        </div>
        <div className="grid shrink-0 grid-cols-1 border-t border-rule sm:grid-cols-2">
          {summary.isError ? (
            <p role="alert" className="mnemonic col-span-full px-1 py-0.5 text-xs text-warning">
              SUMMARY UNAVAILABLE — {summary.error.message.toUpperCase()}
            </p>
          ) : (
            <>
              <Readout
                label="MIN"
                value={scaled(stats?.min)}
                unit={meta.unit}
                decimals={meta.decimals}
              />
              <Readout
                label="MAX"
                value={scaled(stats?.max)}
                unit={meta.unit}
                decimals={meta.decimals}
              />
              <Readout
                label="AVG"
                value={scaled(stats?.avg)}
                unit={meta.unit}
                decimals={meta.decimals}
              />
              <LiveReadout satId={satId} metric={metric} />
              <Readout
                label="ECLIPSE FRACTION"
                value={
                  summary.data?.eclipseFrac === null || !summary.data
                    ? null
                    : summary.data.eclipseFrac * 100
                }
                unit="%"
                decimals={1}
              />
              <Readout
                label="ALERTS IN RANGE"
                value={summary.data?.alertCount ?? null}
                decimals={0}
              />
            </>
          )}
        </div>
      </Panel>

      <Panel
        title="BATTERY VS ECLIPSE"
        subtitle="ONE POINT PER ROLLUP MINUTE · LEAST-SQUARES TREND"
        flush
        className="min-h-[256px] flex-[2]"
      >
        {scatter.isError ? (
          <ErrorState error={scatter.error} onRetry={() => void scatter.refetch()} />
        ) : scatterData ? (
          <EclipseScatter data={scatterData} />
        ) : (
          <LoadingState label="LOADING ROLLUPS" />
        )}
      </Panel>
    </>
  );
}
