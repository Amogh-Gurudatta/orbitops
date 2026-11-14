// Pass Gantt for one station: a row per satellite, a bar from AOS to LOS per pass. Grey bars with a magenta
// outline are predictions, the pass in progress is white, a white "now" line crosses the rows, and a tick ruler
// (UTC hours) stays pinned above the scrolling rows. Plain SVG keeps the styling exact.
import { useMemo, useRef, useState, useEffect } from 'react';
import type { Pass } from '../../api/types.ts';
import { cx } from '../../lib/cx.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { utcClock } from '../fleet/AlarmLog.tsx';
import { formatDuration, layoutPassRows, rulerTicks, type TimelineBar } from './passLayout.ts';

const GUTTER = 176;
const ROW_H = 16;
const BAR_H = 8;
const RULER_H = 24;
/** Window starts this long before now so a pass already in progress shows its beginning. */
const LEAD_MS = 10 * 60_000;
const SPAN_MS = 12 * 3_600_000;

interface Hover {
  bar: TimelineBar;
  satName: string;
  x: number;
  y: number;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function PassTimeline({
  passes,
  now,
  selectedSatId,
  onSelectSat,
}: {
  /** Passes at the selected station only. */
  passes: readonly Pass[];
  now: number;
  selectedSatId: number | null;
  onSelectSat(satId: number): void;
}) {
  const catalog = useFleetStore((s) => s.catalog);
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<Hover | null>(null);

  const startMs = now - LEAD_MS;
  const endMs = startMs + SPAN_MS;
  const rows = useMemo(
    () => layoutPassRows(passes, startMs, endMs, now),
    [passes, startMs, endMs, now],
  );
  const ticks = useMemo(() => rulerTicks(startMs, endMs), [startMs, endMs]);

  const plotW = Math.max(0, width - GUTTER - 8);
  const px = (fraction: number) => GUTTER + fraction * plotW;
  const nowX = px(LEAD_MS / SPAN_MS);
  const bodyH = rows.length * ROW_H;

  const showTip = (event: React.MouseEvent, bar: TimelineBar) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setHover({
      bar,
      satName: catalog[bar.pass.satId]?.name ?? String(bar.pass.satId),
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  };

  return (
    <div
      ref={ref}
      className="relative flex h-full min-h-0 flex-col"
      onMouseLeave={() => setHover(null)}
    >
      <svg
        width={width}
        height={RULER_H}
        className="shrink-0 border-b border-rule"
        role="img"
        aria-label="Pass timeline ruler, UTC hours"
      >
        <text x={8} y={16} className="mnemonic fill-text-2 text-xs" style={{ fontSize: 11 }}>
          SAT
        </text>
        <text
          x={GUTTER - 8}
          y={16}
          textAnchor="end"
          className="mnemonic fill-text-dim"
          style={{ fontSize: 10 }}
        >
          UTC
        </text>
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={px(t.x)} x2={px(t.x)} y1={t.major ? 16 : 20} y2={RULER_H} stroke="#62615b" />
            {t.major && (
              <text
                x={px(t.x)}
                y={12}
                textAnchor="middle"
                className="num fill-text-2"
                style={{ fontSize: 10 }}
              >
                {t.label}
              </text>
            )}
          </g>
        ))}
        <line x1={nowX} x2={nowX} y1={0} y2={RULER_H} stroke="#ffffff" />
      </svg>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {rows.length === 0 ? null : (
          <svg width={width} height={bodyH} role="img" aria-label="Pass timeline">
            {ticks
              .filter((t) => t.major)
              .map((t) => (
                <line key={t.x} x1={px(t.x)} x2={px(t.x)} y1={0} y2={bodyH} stroke="#2e2f2c" />
              ))}
            {rows.map((row, i) => {
              const y = i * ROW_H;
              const selected = row.satId === selectedSatId;
              return (
                <g
                  key={row.satId}
                  onClick={() => onSelectSat(row.satId)}
                  className="cursor-pointer"
                >
                  <rect
                    x={0}
                    y={y}
                    width={width}
                    height={ROW_H}
                    fill={selected ? '#2e2f2c' : 'transparent'}
                  />
                  <line
                    x1={0}
                    x2={width}
                    y1={y + ROW_H - 0.5}
                    y2={y + ROW_H - 0.5}
                    stroke="#2e2f2c"
                  />
                  <text
                    x={8}
                    y={y + 12}
                    className={cx('num', selected ? 'fill-select' : 'fill-text-2')}
                    style={{ fontSize: 10 }}
                  >
                    {(catalog[row.satId]?.name ?? String(row.satId)).slice(0, 20)}
                  </text>
                  {row.bars.map((bar) => (
                    <g key={bar.pass.aos}>
                      <rect
                        x={px(bar.x)}
                        y={y + (ROW_H - BAR_H) / 2}
                        width={Math.max(2, bar.width * plotW)}
                        height={BAR_H}
                        fill={bar.active ? '#ffffff' : '#62615b'}
                        stroke={bar.active ? 'none' : '#d04fd0'}
                        strokeWidth={1}
                      />
                      {/* Full-height hit area: an 8 px bar is too small to hover reliably. */}
                      <rect
                        x={px(bar.x)}
                        y={y}
                        width={Math.max(4, bar.width * plotW)}
                        height={ROW_H}
                        fill="transparent"
                        onMouseMove={(e) => showTip(e, bar)}
                      />
                    </g>
                  ))}
                </g>
              );
            })}
            <line x1={nowX} x2={nowX} y1={0} y2={bodyH} stroke="#ffffff" />
          </svg>
        )}
      </div>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 border border-rule bg-panel px-1 py-0.5 text-xs"
          style={{ left: Math.min(hover.x + 12, Math.max(0, width - 188)), top: hover.y + 12 }}
        >
          <div className="font-bold text-text">{hover.satName}</div>
          <TipRow label="AOS" value={`${utcClock(hover.bar.pass.aos)} UTC`} />
          <TipRow label="LOS" value={`${utcClock(hover.bar.pass.los)} UTC`} />
          <TipRow label="MAX EL" value={`${hover.bar.pass.maxElevDeg.toFixed(1)}°`} />
          <TipRow
            label="DURATION"
            value={formatDuration(hover.bar.pass.los - hover.bar.pass.aos)}
          />
        </div>
      )}
    </div>
  );
}

function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[160px] justify-between gap-2">
      <span className="mnemonic text-text-2">{label}</span>
      <span className="num text-text">{value}</span>
    </div>
  );
}
