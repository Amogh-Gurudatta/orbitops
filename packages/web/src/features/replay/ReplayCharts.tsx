// Replay telemetry for one satellite: readouts holding the values at the playhead and strip charts fed
// imperatively with a window of the fetched history centred on the playhead (white marker = playhead).
import { useEffect, useRef } from 'react';
import { StripChart, type StripChartHandle } from '../../charts/StripChart.tsx';
import { Readout, type ReadoutState } from '../../ui/index.ts';
import { CHART_SPECS, limitState, type ChartKey } from '../satellite/chartSpecs.ts';
import { COVERAGE_GAP_MS, type ReplayColumns } from './useReplayData.ts';
import { buildChartWindow, valueAt } from './seriesLookup.ts';
import { REPLAY_METRICS } from './replayApi.ts';

const CHART_KEYS = ['batSoc', 'panelTempC', 'solarW'] as const satisfies readonly ChartKey[];
const READOUT_KEYS = REPLAY_METRICS satisfies readonly ChartKey[];

/** Chart y axis is 48 px wide and the plot has 8 px right padding (see StripChart). */
const PLAYHEAD_LEFT = 'calc(48px + (100% - 56px) / 2)';

export function ReplayReadouts({ data, timeMs }: { data: ReplayColumns | null; timeMs: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2">
      {READOUT_KEYS.map((key) => {
        const spec = CHART_SPECS[key];
        const raw = data ? valueAt(data.tMs, data.columns[key]!, timeMs, COVERAGE_GAP_MS) : null;
        const value = raw === null ? null : raw * spec.factor;
        const state: ReadoutState = value === null ? 'stale' : limitState(value, spec.limits);
        return (
          <Readout
            key={key}
            label={spec.label}
            value={value}
            unit={spec.unit}
            decimals={spec.decimals}
            state={state}
          />
        );
      })}
    </div>
  );
}

export function ReplayCharts({
  data,
  timeMs,
  windowMs,
}: {
  data: ReplayColumns;
  timeMs: number;
  windowMs: number;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {CHART_KEYS.map((key) => (
        <ReplayChart key={key} chartKey={key} data={data} timeMs={timeMs} windowMs={windowMs} />
      ))}
    </div>
  );
}

function ReplayChart({
  chartKey,
  data,
  timeMs,
  windowMs,
}: {
  chartKey: ChartKey;
  data: ReplayColumns;
  timeMs: number;
  windowMs: number;
}) {
  const spec = CHART_SPECS[chartKey];
  const handle = useRef<StripChartHandle>(null);

  useEffect(() => {
    const half = windowMs / 2;
    const { t, y } = buildChartWindow(
      data.tMs,
      data.columns[spec.metric]!,
      timeMs - half,
      timeMs + half,
      COVERAGE_GAP_MS,
      spec.factor,
    );
    handle.current?.setData(t, [y]);
  }, [data, timeMs, windowMs, spec]);

  return (
    <div
      // The legend's time/value follow the cursor; the padded window edge would show a misleading
      // time and a dash, so they are visible only while hovering.
      className="relative min-h-[96px] flex-1 border-t border-rule [&:not(:hover)_[data-legend-time]]:invisible [&:not(:hover)_[data-legend-value]]:invisible"
    >
      <StripChart
        ref={handle}
        aria-label={`${spec.label} replay chart`}
        series={[{ label: spec.label, unit: spec.unit, decimals: spec.decimals }]}
        normalBand={spec.normalBand}
        limits={spec.limits}
        minSpan={spec.minSpan}
        gapSeconds={COVERAGE_GAP_MS / 1000}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[24px] bottom-[22px] w-px bg-select"
        style={{ left: PLAYHEAD_LEFT }}
      />
    </div>
  );
}
