// One strip chart for a satellite metric: pulls live + history data from the store on the shared frame
// loop, in display units, with the spec's normal band and limits. Rollup ranges add a min/max envelope.
import { useMemo } from 'react';
import { StripChart, type StripSeries } from '../../charts/StripChart.tsx';
import { telemetryStore } from '../../realtime/telemetryStore.ts';
import { cx } from '../../lib/cx.ts';
import type { BandColumns } from './chartSources.ts';
import { createChartSource } from './chartSources.ts';
import type { ChartSpec } from './chartSpecs.ts';
import { chartHz, gapSeconds, windowSeconds, type RangeConfig } from './ranges.ts';

export interface SatChartProps {
  satId: number;
  spec: ChartSpec;
  range: RangeConfig;
  bands?: BandColumns | null;
  className?: string;
}

export function SatChart({ satId, spec, range, bands, className }: SatChartProps) {
  const windowS = windowSeconds(range);
  const gaps = gapSeconds(range);
  const source = useMemo(() => {
    const reader = telemetryStore.reader(satId, [spec.metric]);
    return createChartSource(
      { pull: () => reader.read(windowS) },
      { factor: spec.factor, bands, gapSeconds: gaps },
    );
  }, [satId, spec.metric, spec.factor, windowS, bands, gaps]);

  const series = useMemo<StripSeries[]>(() => {
    const main = { label: spec.label, unit: spec.unit, decimals: spec.decimals };
    return bands
      ? [main, { ...main, label: 'MIN', unit: '' }, { ...main, label: 'MAX', unit: '' }]
      : [main];
  }, [spec, bands]);

  return (
    <div className={cx('min-h-[96px] flex-1 border-t border-rule', className)}>
      <StripChart
        aria-label={`${spec.label} strip chart`}
        series={series}
        source={source}
        hz={chartHz(range)}
        normalBand={spec.normalBand}
        limits={spec.limits}
        minSpan={spec.minSpan}
        gapSeconds={gaps}
      />
    </div>
  );
}
