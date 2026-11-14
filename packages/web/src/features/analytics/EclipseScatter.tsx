// Battery state of charge against eclipse fraction, one point per rollup minute, with a
// least-squares trend line: the physics (less sun, less charge) visible in the data.
import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { TelemetryHistory } from '../../api/types.ts';
import { EChart } from '../../charts/EChart.tsx';
import { GREY_SERIES, TOKENS } from '../../charts/tokens.ts';
import { EmptyState } from '../../ui/index.ts';
import { leastSquares, type LinearFit } from './regression.ts';

export interface ScatterPoints {
  points: [number, number][];
  fit: LinearFit | null;
}

/** x = eclipse %, y = state of charge %, from a rollup history with `eclipseFrac` and `batSoc`. */
export function scatterPoints(history: TelemetryHistory): ScatterPoints {
  const ecl = history.series.eclipseFrac ?? [];
  const soc = history.series.batSoc ?? [];
  const xs: (number | null)[] = [];
  const ys: (number | null)[] = [];
  const points: [number, number][] = [];
  for (let i = 0; i < Math.min(ecl.length, soc.length); i++) {
    const e = ecl[i];
    const s = soc[i];
    if (e === null || e === undefined || s === null || s === undefined) continue;
    xs.push(e * 100);
    ys.push(s * 100);
    points.push([e * 100, s * 100]);
  }
  return { points, fit: leastSquares(xs, ys) };
}

export function EclipseScatter({ data }: { data: ScatterPoints }) {
  const { points, fit } = data;
  const option = useMemo<EChartsCoreOption>(
    () => ({
      animation: false,
      grid: { top: 16, right: 16, bottom: 32, left: 48 },
      tooltip: {
        trigger: 'item',
        formatter: (p: { value: [number, number] }) =>
          `ECLIPSE ${p.value[0].toFixed(0)} %<br/>SOC ${p.value[1].toFixed(1)} %`,
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: 100,
        name: 'ECLIPSE %',
        nameLocation: 'middle',
        nameGap: 22,
      },
      yAxis: { type: 'value', scale: true, name: 'SOC %', nameLocation: 'end' },
      series: [
        {
          type: 'scatter',
          data: points,
          symbolSize: 4,
          itemStyle: { color: GREY_SERIES[1], opacity: 0.7 },
        },
        ...(fit
          ? [
              {
                type: 'line',
                data: [
                  [0, fit.intercept],
                  [100, fit.intercept + fit.slope * 100],
                ],
                silent: true,
                symbol: 'none',
                lineStyle: { color: TOKENS.text, width: 1.5, type: 'dashed' },
                z: 3,
              },
            ]
          : []),
      ],
    }),
    [points, fit],
  );

  if (points.length < 2)
    return (
      <EmptyState
        title="NOT ENOUGH ROLLUP DATA"
        detail="Rollups are written once a minute; check back shortly."
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <EChart aria-label="Battery charge against eclipse fraction scatter" option={option} />
      </div>
      <p className="mnemonic flex flex-wrap gap-x-2 border-t border-grid px-1 py-0.5 text-xs text-text-2">
        <span>TREND</span>
        {fit ? (
          <>
            <span className="num text-text">
              SLOPE {fit.slope >= 0 ? '+' : ''}
              {fit.slope.toFixed(3)} %SOC / %ECL
            </span>
            <span className="num text-text">R² {fit.r2.toFixed(2)}</span>
          </>
        ) : (
          <span className="text-text-dim">UNDEFINED (NO ECLIPSE VARIATION)</span>
        )}
        <span className="num text-text-dim">N {points.length}</span>
      </p>
    </div>
  );
}
