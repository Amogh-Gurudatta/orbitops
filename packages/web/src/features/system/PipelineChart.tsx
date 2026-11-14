// StripChart fed from the stats history ring (1 Hz): pushes new arrays whenever a sample arrives.
import { useEffect, useRef } from 'react';
import { StripChart, type StripChartHandle, type StripSeries } from '../../charts/StripChart.tsx';
import type { StatKey, StatsHistory } from './statsHistory.ts';

export interface PipelineSeries extends StripSeries {
  key: StatKey;
}

export function PipelineChart({
  history,
  samples,
  series,
  label,
}: {
  history: StatsHistory;
  /** Changes with every recorded sample; drives the redraw. */
  samples: unknown;
  series: readonly PipelineSeries[];
  label: string;
}) {
  const handle = useRef<StripChartHandle>(null);
  useEffect(() => {
    handle.current?.setData(
      history.t(),
      series.map((s) => history.series(s.key)),
    );
  }, [history, samples, series]);
  return (
    <div className="h-[120px] border-b border-rule">
      <StripChart
        ref={handle}
        aria-label={label}
        series={series}
        hz={1}
        gapSeconds={5}
        className="min-h-0!"
      />
    </div>
  );
}
