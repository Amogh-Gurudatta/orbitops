// Fleet heatmap: one row per satellite (grouped), one column per time bucket. Grey ramp for the
// normal range; amber / red only past the metric's limits; empty cells show the hatched no-data fill.
// Click a cell (or a row label) to study that satellite.
import { useEffect, useMemo, useRef } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { Limits } from '../../charts/StripChart.tsx';
import { EChart, type EChartHandle } from '../../charts/EChart.tsx';
import { GREY_RAMP, TOKENS } from '../../charts/tokens.ts';
import type { Heatmap, Satellite } from '../../api/types.ts';
import { formatUtcClock, formatUtcDateTime } from '../../lib/formatTime.ts';
import { METRIC_META } from '../../realtime/metrics.ts';
import { buildPieces, labelStepMs, satAxisLabel, valueExtent } from './heatmap.ts';
import type { AnalyticsMetric } from './metrics.ts';

const ROW_H = 12;
const GRID = { top: 16, bottom: 24, left: 192, right: 8 } as const;
const GROUP_GUTTER = 64;

export interface FleetHeatmapProps {
  data: Heatmap;
  metric: AnalyticsMetric;
  limits: Limits | undefined;
  rangeMs: number;
  bucketMin: number;
  catalog: Readonly<Record<number, Satellite>>;
  selectedSatId: number | null;
  onSelect(satId: number): void;
}

export function FleetHeatmap({
  data,
  metric,
  limits,
  rangeMs,
  bucketMin,
  catalog,
  selectedSatId,
  onSelect,
}: FleetHeatmapProps) {
  const chartRef = useRef<EChartHandle>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const meta = METRIC_META[metric];
  const bucketMs = bucketMin * 60_000;

  const labels = useMemo(
    () => data.satIds.map((id) => satAxisLabel(id, catalog[id]?.name)),
    [data.satIds, catalog],
  );

  const option = useMemo<EChartsCoreOption>(() => {
    const extent = valueExtent(data.values) ?? [0, 1];
    const cells: [number, number, number][] = [];
    data.values.forEach((row, y) =>
      row.forEach((value, x) => {
        if (value !== null) cells.push([x, y, value]);
      }),
    );
    const step = labelStepMs(rangeMs);
    const showDate = rangeMs > 24 * 3_600_000;
    const onStep = (index: number) => (data.buckets[index] ?? 0) % step === 0;
    return {
      animation: false,
      grid: { ...GRID },
      tooltip: {
        confine: true,
        formatter: (p: { value: [number, number, number] }) => {
          const [x, y, v] = p.value;
          const sat = catalog[data.satIds[y]!];
          return [
            `${data.satIds[y]} ${sat?.name ?? ''}`,
            `${formatUtcDateTime(data.buckets[x]!)}Z`,
            `${(v * meta.scale).toFixed(meta.decimals)} ${meta.unit}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'category',
        data: data.buckets.map(String),
        splitLine: { show: false },
        axisLabel: {
          interval: (index: number) => onStep(index),
          formatter: (value: string) => formatUtcClock(Number(value), showDate),
        },
        axisTick: { interval: (index: number) => onStep(index) },
      },
      yAxis: {
        type: 'category',
        data: labels,
        inverse: true,
        triggerEvent: true,
        splitLine: { show: false },
        axisTick: { show: false },
        axisLabel: { interval: 0, fontSize: 9, color: TOKENS.text2 },
      },
      visualMap: {
        type: 'piecewise',
        show: false,
        dimension: 2,
        pieces: buildPieces(limits, extent[0], extent[1]),
      },
      series: [
        {
          type: 'heatmap',
          data: cells,
          progressive: 0,
          itemStyle: { borderWidth: 0 },
          emphasis: { itemStyle: { borderColor: TOKENS.select, borderWidth: 1 } },
        },
      ],
    };
  }, [data, labels, rangeMs, limits, catalog, meta]);

  // Click handling: a heatmap cell, or a satellite row label.
  useEffect(() => {
    const chart = chartRef.current?.chart();
    if (!chart) return;
    const handler = (p: { componentType: string; value?: unknown; data?: unknown }) => {
      if (p.componentType === 'series' && Array.isArray(p.data))
        selectRef.current(data.satIds[p.data[1] as number]!);
      else if (p.componentType === 'yAxis') {
        const index = labels.indexOf(String(p.value));
        if (index >= 0) selectRef.current(data.satIds[index]!);
      }
    };
    chart.on('click', handler);
    return () => void chart.off('click', handler);
  }, [data.satIds, labels]);

  const plotHeight = data.satIds.length * ROW_H;
  const totalHeight = plotHeight + GRID.top + GRID.bottom;

  // Group separators and labels, aligned to the fixed row height.
  const groups = useMemo(() => {
    const out: { name: string; start: number; count: number }[] = [];
    data.satIds.forEach((id, i) => {
      const name = catalog[id]?.group ?? '';
      const last = out.at(-1);
      if (last && last.name === name) last.count++;
      else out.push({ name, start: i, count: 1 });
    });
    return out;
  }, [data.satIds, catalog]);

  const first = data.buckets[0];
  const nowFraction =
    first === undefined
      ? null
      : Math.min(1, Math.max(0, (Date.now() - first) / (data.buckets.length * bucketMs)));
  const selectedRow = selectedSatId === null ? -1 : data.satIds.indexOf(selectedSatId);

  return (
    <div className="relative" style={{ height: totalHeight }}>
      {/* No-data fill: transparent chart cells let this hatch show through. */}
      <div
        aria-hidden="true"
        className="hatch absolute"
        style={{ top: GRID.top, bottom: GRID.bottom, left: GRID.left, right: GRID.right }}
      />
      <EChart
        ref={chartRef}
        aria-label={`Fleet heatmap of ${meta.label}`}
        className="absolute inset-0 min-h-0!"
        option={option}
      />

      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {groups.map((g) => (
          <div
            key={`${g.name}-${g.start}`}
            className="absolute right-0 left-0 border-t border-rule"
            style={{ top: GRID.top + g.start * ROW_H, height: g.count * ROW_H }}
          >
            <span
              className="mnemonic absolute top-0 left-1 truncate pr-0.5 text-2xs text-text-dim"
              style={{ width: GROUP_GUTTER - 8 }}
            >
              {g.name}
            </span>
          </div>
        ))}
        {selectedRow >= 0 && (
          <div
            className="absolute border border-select"
            style={{
              top: GRID.top + selectedRow * ROW_H,
              height: ROW_H,
              left: GRID.left - 112,
              right: GRID.right,
            }}
          />
        )}
        {nowFraction !== null && (
          <div
            className="absolute border-l border-dashed border-text-2"
            style={{
              top: GRID.top - 4,
              height: plotHeight + 4,
              left: `calc(${GRID.left}px + (100% - ${GRID.left + GRID.right}px) * ${nowFraction})`,
            }}
          >
            <span className="mnemonic absolute -top-1 -translate-x-full pr-0.5 text-2xs text-text-2">
              NOW
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function HeatmapLegend({
  limits,
  metric,
  extent,
}: {
  limits: Limits | undefined;
  metric: AnalyticsMetric;
  extent: [number, number] | null;
}) {
  const meta = METRIC_META[metric];
  const fmt = (v: number) => (v * meta.scale).toFixed(meta.decimals);
  const marks: { tone: 'caution' | 'warning'; text: string }[] = [];
  for (const tone of ['caution', 'warning'] as const) {
    const pair = limits?.[tone];
    if (pair?.lo !== undefined)
      marks.push({ tone, text: `${tone.toUpperCase()} < ${fmt(pair.lo)}` });
    if (pair?.hi !== undefined)
      marks.push({ tone, text: `${tone.toUpperCase()} ≥ ${fmt(pair.hi)}` });
  }
  return (
    <div className="mnemonic flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-2">
      <span className="flex items-center gap-0.5">
        <span className="num text-text-dim">{extent ? fmt(extent[0]) : '—'}</span>
        {GREY_RAMP.map((color) => (
          <span
            key={color}
            className="inline-block h-1 w-1.5 border border-rule"
            style={{ background: color }}
          />
        ))}
        <span className="num text-text-dim">{extent ? fmt(extent[1]) : '—'}</span>
        <span className="text-text-dim">{meta.unit}</span>
      </span>
      {marks.map((m) => (
        <span key={m.text} className="flex items-center gap-0.5">
          <span
            className="inline-block h-1 w-1.5"
            style={{ background: m.tone === 'warning' ? TOKENS.warning : TOKENS.caution }}
          />
          {m.text}
        </span>
      ))}
      <span className="flex items-center gap-0.5">
        <span className="hatch-strong inline-block h-1 w-1.5 border border-rule" />
        NO DATA
      </span>
    </div>
  );
}
