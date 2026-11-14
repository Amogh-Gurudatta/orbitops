// EChart: thin React wrapper over echarts.init. Registers the "greyroom" theme once, sizes via
// ResizeObserver, applies options with lazyUpdate and disposes the instance on unmount.
// Only the chart types this app uses are registered to keep the bundle small.
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { cx } from '../lib/cx.ts';
import { GREY_SERIES, TOKENS } from './tokens.ts';

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  ScatterChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

const axisCommon = {
  axisLine: { lineStyle: { color: TOKENS.rule } },
  axisTick: { lineStyle: { color: TOKENS.rule } },
  axisLabel: { color: TOKENS.textDim, fontFamily: TOKENS.fontMono, fontSize: 10 },
  splitLine: { lineStyle: { color: TOKENS.grid } },
  nameTextStyle: { color: TOKENS.text2, fontFamily: TOKENS.fontMono },
};

export const GREYROOM_THEME = 'greyroom';

echarts.registerTheme(GREYROOM_THEME, {
  color: [...GREY_SERIES],
  backgroundColor: 'transparent',
  animation: false,
  textStyle: { color: TOKENS.text2, fontFamily: TOKENS.fontMono },
  title: { textStyle: { color: TOKENS.text2 } },
  categoryAxis: axisCommon,
  valueAxis: axisCommon,
  timeAxis: axisCommon,
  line: { symbol: 'none', lineStyle: { width: 1.25 } },
  legend: { textStyle: { color: TOKENS.text2, fontFamily: TOKENS.fontMono } },
  tooltip: {
    backgroundColor: TOKENS.panel,
    borderColor: TOKENS.select,
    borderWidth: 1,
    padding: [4, 8],
    extraCssText: 'border-radius:0;box-shadow:none;',
    textStyle: { color: TOKENS.text, fontFamily: TOKENS.fontMono, fontSize: 11 },
  },
  visualMap: { textStyle: { color: TOKENS.text2 } },
});

export interface EChartHandle {
  chart(): EChartsType | null;
}

export interface EChartProps {
  option: EChartsCoreOption;
  /** Replace instead of merging with the previous option. */
  notMerge?: boolean;
  className?: string;
  'aria-label': string;
  ref?: Ref<EChartHandle>;
}

export function EChart({ option, notMerge, className, ref, ...aria }: EChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useImperativeHandle(ref, () => ({ chart: () => chartRef.current }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = echarts.init(host, GREYROOM_THEME, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.setOption(optionRef.current, { lazyUpdate: true });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(host);
    return () => {
      resize.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge, lazyUpdate: true });
  }, [option, notMerge]);

  return (
    <div
      ref={hostRef}
      className={cx('h-full min-h-16 w-full', className)}
      role="img"
      aria-label={aria['aria-label']}
    />
  );
}
