// TIMELINE: SVG ruler for the replay window. Hour ticks (UTC labels) and 10-minute ticks, a coverage
// band hatched where no data exists, alert markers, and a draggable white playhead.
import { memo, useEffect, useRef, useState, type PointerEvent } from 'react';
import { TOKENS } from '../../charts/tokens.ts';
import { generateTicks, timeToX, xToTime, type TimeSpan } from './timeline.ts';

export interface AlertMarker {
  t: number;
  severity: 'WARNING' | 'CAUTION';
  /** Belongs to the selected satellite: drawn taller. */
  selected: boolean;
}

export interface TimelineProps {
  span: TimeSpan;
  timeMs: number;
  onSeek(t: number): void;
  /** Spans of the window with no data for the selected satellite. */
  gaps: readonly (readonly [number, number])[];
  /** False while coverage is still loading (nothing is hatched yet). */
  coverageKnown: boolean;
  markers: readonly AlertMarker[];
}

const HEIGHT = 80;
const PAD_L = 40;
const PAD_R = 16;
const RULER_Y = 28;
const BAND = { top: 34, bottom: 50 };
const ALERT_ROW = { top: 54, bottom: 76 };

export function Timeline(props: TimelineProps) {
  const { span, timeMs, onSeek } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(host);
    setWidth(host.clientWidth);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(0, width - PAD_L - PAD_R);
  const seekFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(xToTime(event.clientX - rect.left - PAD_L, span, plotWidth));
  };

  const x = PAD_L + timeToX(timeMs, span, plotWidth);
  const label = new Date(timeMs).toISOString().slice(11, 19) + 'Z';
  const labelRight = x > width - 80;

  return (
    <div ref={hostRef} className="w-full select-none" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="slider"
          tabIndex={0}
          aria-label="Replay playhead"
          aria-valuemin={span.from}
          aria-valuemax={span.to}
          aria-valuenow={Math.round(timeMs)}
          aria-valuetext={label}
          className="cursor-ew-resize touch-none"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seekFromPointer(e);
          }}
          onPointerMove={(e) => dragging.current && seekFromPointer(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <TimelineStatic {...props} plotWidth={plotWidth} />
          <line x1={x} x2={x} y1={14} y2={HEIGHT} stroke={TOKENS.select} strokeWidth={1} />
          <rect x={labelRight ? x - 66 : x} y={0} width={66} height={14} fill={TOKENS.select} />
          <text
            x={labelRight ? x - 33 : x + 33}
            y={10}
            textAnchor="middle"
            fontSize={10}
            fontFamily={TOKENS.fontMono}
            fill={TOKENS.bg}
          >
            {label}
          </text>
        </svg>
      )}
    </div>
  );
}

const TimelineStatic = memo(function TimelineStatic({
  span,
  gaps,
  coverageKnown,
  markers,
  plotWidth,
}: TimelineProps & { plotWidth: number }) {
  const px = (t: number) => PAD_L + timeToX(t, span, plotWidth);
  const ticks = generateTicks(span);
  return (
    <g fontFamily={TOKENS.fontMono} fontSize={10}>
      <defs>
        <pattern id="tl-hatch" width={6} height={6} patternUnits="userSpaceOnUse">
          <path d="M-1 1l2-2M0 6l6-6M5 7l2-2" stroke={TOKENS.textDim} strokeWidth={1} />
        </pattern>
      </defs>

      {/* Row labels */}
      <text x={4} y={BAND.bottom - 5} fill={TOKENS.textDim} fontSize={10}>
        DATA
      </text>
      <text x={4} y={ALERT_ROW.bottom - 6} fill={TOKENS.textDim} fontSize={10}>
        ALM
      </text>

      {/* Ruler */}
      <line x1={PAD_L} x2={PAD_L + plotWidth} y1={RULER_Y} y2={RULER_Y} stroke={TOKENS.rule} />
      {ticks.map((tick) => (
        <g key={tick.t}>
          <line
            x1={px(tick.t)}
            x2={px(tick.t)}
            y1={tick.major ? RULER_Y - 10 : RULER_Y - 5}
            y2={RULER_Y}
            stroke={tick.major ? TOKENS.text2 : TOKENS.textDim}
          />
          {tick.major && (
            <text x={px(tick.t)} y={RULER_Y - 14} textAnchor="middle" fill={TOKENS.text2}>
              {tick.label}
            </text>
          )}
        </g>
      ))}

      {/* Coverage band: solid where data exists, hatched where none */}
      <rect
        x={PAD_L}
        y={BAND.top}
        width={plotWidth}
        height={BAND.bottom - BAND.top}
        fill={coverageKnown ? TOKENS.rule : 'url(#tl-hatch)'}
        stroke={TOKENS.rule}
      />
      {coverageKnown &&
        gaps.map(([a, b]) => (
          <rect
            key={a}
            x={px(a)}
            y={BAND.top}
            width={Math.max(0, px(b) - px(a))}
            height={BAND.bottom - BAND.top}
            fill="url(#tl-hatch)"
            stroke={TOKENS.rule}
          />
        ))}
      {/* Alert markers: selected satellite's are taller */}
      <line
        x1={PAD_L}
        x2={PAD_L + plotWidth}
        y1={ALERT_ROW.bottom}
        y2={ALERT_ROW.bottom}
        stroke={TOKENS.grid}
      />
      {markers.map((m, i) => (
        <line
          key={`${m.t}-${i}`}
          x1={px(m.t)}
          x2={px(m.t)}
          y1={m.selected ? ALERT_ROW.top : ALERT_ROW.top + 8}
          y2={ALERT_ROW.bottom}
          stroke={m.severity === 'WARNING' ? TOKENS.warning : TOKENS.caution}
          strokeWidth={m.selected ? 2 : 1}
        />
      ))}
    </g>
  );
});
