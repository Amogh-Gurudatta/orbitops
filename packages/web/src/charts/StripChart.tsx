// StripChart: thin React wrapper over uPlot, styled Grey Room.
//  - the uPlot instance is created once (per structural change) and only ever receives setData;
//  - data arrives through a `source` pulled from the shared frame loop (no React re-render per sample)
//    or imperatively via the ref handle;
//  - grey traces; only the part of the first series beyond caution/warning limits turns amber/red;
//  - optional normal-range band, dashed limit lines, hatched no-data gaps, cursor legend.
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import uPlot from 'uplot';
import { cx } from '../lib/cx.ts';
import { onFrame } from '../realtime/frameLoop.ts';
import type { ChartSource } from '../realtime/useRealtime.ts';
import { TOKENS } from './tokens.ts';

export interface StripSeries {
  /** Mnemonic shown in the legend. */
  label: string;
  unit?: string;
  decimals?: number;
  /** Multiplier for display only (e.g. 100 for a 0..1 fraction shown as %). */
  scale?: number;
}

interface LimitPair {
  lo?: number;
  hi?: number;
}

/** Limits apply to the first series: the trace turns amber/red beyond them and dashed lines are drawn. */
export interface Limits {
  caution?: LimitPair;
  warning?: LimitPair;
}

export interface StripChartHandle {
  /** Imperative feed: x in epoch seconds; NaN/null in a series = no data (hatched gap). */
  setData(t: ArrayLike<number>, series: ArrayLike<number | null>[]): void;
}

export interface StripChartProps {
  series: readonly StripSeries[];
  /** Pulled at `hz` from the shared frame loop; returns null when nothing changed. */
  source?: ChartSource;
  /** Maximum redraws per second (default 10). */
  hz?: number;
  normalBand?: readonly [number, number];
  limits?: Limits;
  /** Fixed y range (disables auto-ranging). */
  yRange?: readonly [number, number];
  /**
   * Smallest y span the auto-range may shrink to (display units). Keeps sensor noise visually quiet
   * instead of stretching a 0.5 °C wobble across the whole panel (ISA-101: stable scales).
   */
  minSpan?: number;
  /** Sample spacing above which the span is drawn as a hatched no-data gap (seconds, default 5). */
  gapSeconds?: number;
  className?: string;
  'aria-label': string;
  ref?: Ref<StripChartHandle>;
}

type Plot = uPlot;
type YData = (number | null)[];

const TRACE_COLORS = [TOKENS.trace, TOKENS.text2, TOKENS.textDim];
const TRACE_DASH: (number[] | undefined)[] = [undefined, [6, 3], [2, 3]];

export function StripChart({
  series,
  source,
  hz = 10,
  normalBand,
  limits,
  yRange,
  minSpan,
  gapSeconds = 5,
  className,
  ref,
  ...aria
}: StripChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<Plot | null>(null);
  const yBuffers = useRef<YData[]>([]);
  const visibleRef = useRef(true);

  // Hooks read the latest props from here, so band/limit changes need no re-creation.
  const live = useRef({ series, normalBand, limits, yRange, minSpan, gapSeconds });
  live.current = { series, normalBand, limits, yRange, minSpan, gapSeconds };

  const structure = series.map((s) => `${s.label}|${s.unit ?? ''}|${s.scale ?? 1}`).join(';');

  const apply = useMemo(
    () => (t: ArrayLike<number>, data: ArrayLike<number | null>[]) => {
      const plot = plotRef.current;
      if (!plot) return;
      const n = t.length;
      const ys = yBuffers.current;
      while (ys.length < data.length) ys.push([]);
      for (let m = 0; m < data.length; m++) {
        const out = ys[m]!;
        const src = data[m]!;
        out.length = n;
        for (let i = 0; i < n; i++) {
          const v = src[i];
          out[i] = v === undefined || v === null || Number.isNaN(v) ? null : v;
        }
      }
      plot.setData(
        [t as unknown as number[], ...ys.slice(0, data.length)] as uPlot.AlignedData,
        true,
      );
    },
    [],
  );

  useImperativeHandle(ref, () => ({ setData: apply }), [apply]);

  // Create once per structure; size follows the container.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const plot = new uPlot(
      buildOptions(live, legendRef, host.clientWidth, host.clientHeight),
      emptyData(live.current.series.length),
      host,
    );
    plotRef.current = plot;
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (width > 0 && height > 0) plot.setSize({ width, height });
    });
    resize.observe(host);
    const visibility = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry!.isIntersecting;
    });
    visibility.observe(host);
    return () => {
      resize.disconnect();
      visibility.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [structure]);

  // Pull from the data source on the shared frame loop.
  useEffect(() => {
    if (!source) return;
    return onFrame(
      () => {
        if (!visibleRef.current) return;
        const data = source.pull();
        if (data) apply(data.t, data.series);
      },
      { hz },
    );
  }, [source, hz, apply, structure]);

  // Props that only need a repaint (not new data).
  useEffect(() => {
    plotRef.current?.redraw(false, true);
  }, [normalBand?.[0], normalBand?.[1], yRange?.[0], yRange?.[1], limitsKey(limits)]);

  return (
    <div className={cx('relative h-full min-h-16 w-full', className)}>
      <div ref={hostRef} className="absolute inset-0" role="img" aria-label={aria['aria-label']} />
      <div
        ref={legendRef}
        className="pointer-events-none absolute top-0.5 left-[52px] flex flex-wrap gap-x-2 text-xs"
        aria-hidden="true"
      >
        <span data-legend-time className="num text-text-dim" />
        {series.map((s, i) => (
          <span key={`${s.label}-${i}`} className="flex gap-0.5">
            <span className="mnemonic text-text-2">{s.label}</span>
            <span data-legend-value={i} className="num text-text">
              —
            </span>
            {s.unit && <span className="text-2xs text-text-dim">{s.unit}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

const limitsKey = (l?: Limits) =>
  l ? [l.caution?.lo, l.caution?.hi, l.warning?.lo, l.warning?.hi].join(',') : '';

function emptyData(seriesCount: number): uPlot.AlignedData {
  return [
    [],
    ...Array.from({ length: seriesCount }, () => [] as (number | null)[]),
  ] as uPlot.AlignedData;
}

type LiveProps = {
  current: {
    series: readonly StripSeries[];
    normalBand?: readonly [number, number];
    limits?: Limits;
    yRange?: readonly [number, number];
    minSpan?: number;
    gapSeconds: number;
  };
};

function toneOf(value: number, limits?: Limits): 'warning' | 'caution' | null {
  if (!limits) return null;
  const { warning, caution } = limits;
  if (
    (warning?.hi !== undefined && value >= warning.hi) ||
    (warning?.lo !== undefined && value <= warning.lo)
  )
    return 'warning';
  if (
    (caution?.hi !== undefined && value >= caution.hi) ||
    (caution?.lo !== undefined && value <= caution.lo)
  )
    return 'caution';
  return null;
}

function buildOptions(
  props: LiveProps,
  legendRef: { current: HTMLDivElement | null },
  width: number,
  height: number,
): uPlot.Options {
  const axisFont = `10px ${TOKENS.fontMono}`;
  const hatch = makeHatch();

  const updateLegend = (u: uPlot) => {
    const legend = legendRef.current;
    if (!legend) return;
    const xs = u.data[0];
    const idx = u.cursor.idx ?? xs.length - 1;
    const timeEl = legend.querySelector<HTMLElement>('[data-legend-time]');
    if (timeEl) timeEl.textContent = idx >= 0 && xs[idx] !== undefined ? formatUtc(xs[idx]!) : '';
    props.current.series.forEach((s, i) => {
      const el = legend.querySelector<HTMLElement>(`[data-legend-value="${i}"]`);
      if (!el) return;
      const raw = idx >= 0 ? (u.data[i + 1]?.[idx] ?? null) : null;
      el.textContent = raw === null ? '—' : (raw * (s.scale ?? 1)).toFixed(s.decimals ?? 1);
      const tone = i === 0 && raw !== null ? toneOf(raw, props.current.limits) : null;
      el.className = cx(
        'num',
        tone === 'warning' ? 'text-warning' : tone === 'caution' ? 'text-caution' : 'text-text',
      );
    });
  };

  return {
    width: Math.max(width, 10),
    height: Math.max(height, 10),
    padding: [24, 8, 0, 0],
    legend: { show: false },
    cursor: { points: { show: false }, drag: { x: false, y: false } },
    tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
    scales: {
      x: { time: true },
      y: {
        range: (_u, min, max) => {
          const { yRange, normalBand, limits, minSpan } = props.current;
          return yRange ? [yRange[0], yRange[1]] : autoRange(min, max, normalBand, limits, minSpan);
        },
      },
    },
    axes: [
      {
        stroke: TOKENS.textDim,
        font: axisFont,
        values: utcTickLabels,
        grid: { stroke: TOKENS.grid, width: 1 },
        ticks: { stroke: TOKENS.rule, width: 1, size: 4 },
        border: { stroke: TOKENS.rule, width: 1 },
      },
      {
        stroke: TOKENS.textDim,
        font: axisFont,
        size: 48,
        grid: { stroke: TOKENS.grid, width: 1 },
        ticks: { stroke: TOKENS.rule, width: 1, size: 4 },
        border: { stroke: TOKENS.rule, width: 1 },
      },
    ],
    series: [
      {},
      ...props.current.series.map((_, i): uPlot.Series => ({
        stroke:
          i === 0 ? (u) => bandedStroke(u, props.current.limits) : TRACE_COLORS[Math.min(i, 2)]!,
        width: 1.25,
        dash: TRACE_DASH[Math.min(i, 2)],
        points: { show: false },
        spanGaps: false,
      })),
    ],
    hooks: {
      drawAxes: [(u) => drawUnderlays(u, props.current, hatch)],
      setCursor: [updateLegend],
      setData: [updateLegend],
    },
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** UTC tick labels: HH:MM:SS for short windows, HH:MM beyond 10 minutes, with a day prefix past 24 h. */
function utcTickLabels(u: uPlot, splits: number[]): string[] {
  const span = (u.scales.x?.max ?? 0) - (u.scales.x?.min ?? 0);
  return splits.map((s) => {
    const d = new Date(s * 1000);
    const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    if (span > 86_400) return `${pad2(d.getUTCDate())}/${hm}`;
    return span > 600 ? hm : `${hm}:${pad2(d.getUTCSeconds())}`;
  });
}

function autoRange(
  min: number | null,
  max: number | null,
  band?: readonly [number, number],
  limits?: Limits,
  minSpan = 0,
): uPlot.Range.MinMax {
  let lo = min ?? band?.[0] ?? 0;
  let hi = max ?? band?.[1] ?? 1;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    const nonNegative = lo >= 0;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
    // Don't invent a negative axis for a quantity that never goes below zero (rates, power).
    if (nonNegative && lo < 0) [lo, hi] = [0, hi - lo];
  }
  if (band) {
    lo = Math.min(lo, band[0]);
    hi = Math.max(hi, band[1]);
  }
  const span = Math.max(hi - lo, 1e-6);
  const reach = span * 0.25;
  const candidates = [
    limits?.caution?.lo,
    limits?.caution?.hi,
    limits?.warning?.lo,
    limits?.warning?.hi,
  ];
  const [dataLo, dataHi] = [lo, hi];
  for (const v of candidates) {
    if (v === undefined) continue;
    if (v >= dataLo - reach && v <= dataHi + reach) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const pad = Math.max((hi - lo) * 0.08, 1e-6);
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  return [lo - pad, hi + pad];
}

/** Hard-stop vertical gradient: grey inside limits, amber past caution, red past warning. */
function bandedStroke(u: uPlot, limits?: Limits): CanvasGradient | string {
  if (!limits) return TOKENS.trace;
  const marks = [limits.warning?.lo, limits.caution?.lo, limits.caution?.hi, limits.warning?.hi]
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
  if (marks.length === 0) return TOKENS.trace;

  const { top, height } = u.bbox;
  const gradient = u.ctx.createLinearGradient(0, top, 0, top + height);
  const colorAt = (v: number) => {
    const tone = toneOf(v, limits);
    return tone === 'warning' ? TOKENS.warning : tone === 'caution' ? TOKENS.caution : TOKENS.trace;
  };
  const offset = (v: number) => Math.min(1, Math.max(0, (u.valToPos(v, 'y', true) - top) / height));

  // Intervals from the top of the plot (highest value) down.
  const edges = [...marks].reverse();
  const bounds = [Infinity, ...edges, -Infinity];
  for (let i = 0; i < bounds.length - 1; i++) {
    const upper = bounds[i]!;
    const lower = bounds[i + 1]!;
    const probe =
      Number.isFinite(upper) && Number.isFinite(lower)
        ? (upper + lower) / 2
        : Number.isFinite(upper)
          ? upper - 1e-6
          : lower + 1e-6;
    const color = colorAt(probe);
    gradient.addColorStop(Number.isFinite(upper) ? offset(upper) : 0, color);
    gradient.addColorStop(Number.isFinite(lower) ? offset(lower) : 1, color);
  }
  return gradient;
}

function drawUnderlays(u: uPlot, props: LiveProps['current'], hatch: CanvasPattern | null): void {
  const { ctx, bbox } = u;
  const px = (v: number) => u.valToPos(v, 'y', true);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();

  if (props.normalBand) {
    const y1 = px(props.normalBand[1]);
    const y0 = px(props.normalBand[0]);
    ctx.fillStyle = 'rgb(190 188 180 / 0.07)';
    ctx.fillRect(bbox.left, y1, bbox.width, y0 - y1);
  }

  drawGaps(u, props.gapSeconds, hatch);

  ctx.lineWidth = Math.max(1, Math.round(devicePixelRatio));
  ctx.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]);
  const lines: [number | undefined, string][] = [
    [props.limits?.caution?.lo, TOKENS.caution],
    [props.limits?.caution?.hi, TOKENS.caution],
    [props.limits?.warning?.lo, TOKENS.warning],
    [props.limits?.warning?.hi, TOKENS.warning],
  ];
  for (const [value, color] of lines) {
    if (value === undefined) continue;
    const y = Math.round(px(value)) + 0.5;
    if (y < bbox.top || y > bbox.top + bbox.height) continue;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(bbox.left, y);
    ctx.lineTo(bbox.left + bbox.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Hatches spans where the first series has no data: sample spacing above gapSeconds, null runs, stale tail. */
function drawGaps(u: uPlot, gapSeconds: number, hatch: CanvasPattern | null): void {
  const xs = u.data[0];
  const ys = u.data[1];
  if (!hatch || !ys || xs.length === 0) return;
  const { ctx, bbox } = u;
  ctx.fillStyle = hatch;
  const fill = (x0: number, x1: number) => {
    const a = u.valToPos(x0, 'x', true);
    const b = u.valToPos(x1, 'x', true);
    ctx.fillRect(a, bbox.top, b - a, bbox.height);
  };

  let lastGood: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] === null || ys[i] === undefined) continue;
    const x = xs[i]!;
    if (lastGood !== null && x - lastGood > gapSeconds) fill(lastGood, x);
    lastGood = x;
  }
  const xMax = u.scales.x?.max;
  if (lastGood !== null && xMax != null && xMax - lastGood > gapSeconds) fill(lastGood, xMax);
}

function makeHatch(): CanvasPattern | null {
  const size = 8 * Math.max(1, Math.round(devicePixelRatio));
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const c = tile.getContext('2d');
  if (!c) return null;
  c.strokeStyle = TOKENS.rule;
  c.lineWidth = Math.max(1, Math.round(devicePixelRatio));
  c.beginPath();
  c.moveTo(-1, size + 1);
  c.lineTo(size + 1, -1);
  c.moveTo(-1, 1);
  c.lineTo(1, -1);
  c.moveTo(size - 1, size + 1);
  c.lineTo(size + 1, size - 1);
  c.stroke();
  return c.createPattern(tile, 'repeat');
}

function formatUtc(epochS: number): string {
  return new Date(epochS * 1000).toISOString().slice(11, 19) + 'Z';
}
