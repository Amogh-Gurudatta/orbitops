// "Historical vs live in one view": rollup history (average + min/max band), the same window one day
// earlier as a dashed baseline, and the live socket tail appended after the last history bucket.
import { useEffect, useMemo, useRef } from 'react';
import { satRoom } from '@orbitops/shared';
import type { AnalyticsSummary, TelemetryHistory } from '../../api/types.ts';
import { StripChart, type Limits, type StripChartHandle } from '../../charts/StripChart.tsx';
import { onFrame } from '../../realtime/frameLoop.ts';
import { METRIC_META } from '../../realtime/metrics.ts';
import { useSubscription } from '../../realtime/useRealtime.ts';
import { telemetryStore } from '../../realtime/telemetryStore.ts';
import { METRIC_LIMITS, type AnalyticsMetric } from './metrics.ts';
import { composeStudySeries } from './studySeries.ts';

const LIVE_HZ = 2;
/** The live ring holds about five minutes; read a little more than that. */
const LIVE_WINDOW_S = 330;
const LIVE_SPACING_S = 5;
const ROLLUP_BUCKET_S = 60;

export function scaleLimits(limits: Limits | undefined, scale: number): Limits | undefined {
  if (!limits) return undefined;
  const scalePair = (pair: Limits['caution']) =>
    pair && {
      ...(pair.lo !== undefined && { lo: pair.lo * scale }),
      ...(pair.hi !== undefined && { hi: pair.hi * scale }),
    };
  return { caution: scalePair(limits.caution), warning: scalePair(limits.warning) };
}

export interface StudyChartProps {
  satId: number;
  metric: AnalyticsMetric;
  rangeMs: number;
  history: TelemetryHistory | undefined;
  baseline: AnalyticsSummary['baseline'][string] | undefined;
}

export function StudyChart({ satId, metric, rangeMs, history, baseline }: StudyChartProps) {
  const handle = useRef<StripChartHandle>(null);
  const meta = METRIC_META[metric];
  useSubscription([satRoom(satId)], LIVE_HZ);

  const limits = useMemo(
    () => scaleLimits(METRIC_LIMITS[metric], meta.scale),
    [metric, meta.scale],
  );

  useEffect(() => {
    if (!history) return;
    // A fresh reader per effect run: its first read always delivers data.
    const reader = telemetryStore.reader(satId, [metric]);
    let composed = false;
    const draw = () => {
      const live = reader.read(LIVE_WINDOW_S);
      if (!live && composed) return;
      composed = true;
      const { t, series } = composeStudySeries({
        histT: history.t,
        avg: history.series[metric] ?? [],
        min: history.series[`${metric}:min`] ?? [],
        max: history.series[`${metric}:max`] ?? [],
        baseT: baseline?.t ?? [],
        baseAvg: baseline?.avg ?? [],
        liveT: live?.t ?? [],
        liveV: live?.series[0] ?? [],
        scale: meta.scale,
        liveSpacingS: LIVE_SPACING_S,
        bucketS: ROLLUP_BUCKET_S,
      });
      handle.current?.setData(t, series);
    };
    draw();
    return onFrame(draw, { hz: LIVE_HZ });
  }, [history, baseline, satId, metric, meta.scale]);

  const gapSeconds = Math.max(600, rangeMs / 1000 / 40);
  return (
    <StripChart
      key={`${satId}-${metric}`}
      ref={handle}
      aria-label={`${meta.label} history, 24 hour baseline and live tail`}
      series={[
        { label: `${meta.label} AVG`, unit: meta.unit, decimals: meta.decimals },
        { label: 'BASE 24H', unit: meta.unit, decimals: meta.decimals },
        { label: 'MIN', unit: meta.unit, decimals: meta.decimals },
        { label: 'MAX', unit: meta.unit, decimals: meta.decimals },
      ]}
      limits={limits}
      gapSeconds={gapSeconds}
    />
  );
}
