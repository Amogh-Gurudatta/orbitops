// Pure layout for the pass Gantt: groups passes into one row per satellite, converts times to 0..1 fractions of
// the visible window and builds the hour ruler. Kept separate from the SVG so it is unit-testable.
import type { Pass } from '../../api/types.ts';

export interface TimelineBar {
  pass: Pass;
  /** Left edge and width as fractions of the window (clamped to it). */
  x: number;
  width: number;
  /** The pass is in progress right now. */
  active: boolean;
}

export interface TimelineRow {
  satId: number;
  bars: TimelineBar[];
}

/** One row per satellite, rows ordered by their earliest visible pass, bars by time. */
export function layoutPassRows(
  passes: readonly Pass[],
  startMs: number,
  endMs: number,
  nowMs: number,
): TimelineRow[] {
  const span = endMs - startMs;
  const rows = new Map<number, TimelineBar[]>();
  for (const pass of passes) {
    if (pass.los <= startMs || pass.aos >= endMs) continue;
    const from = Math.max(pass.aos, startMs);
    const to = Math.min(pass.los, endMs);
    const bar: TimelineBar = {
      pass,
      x: (from - startMs) / span,
      width: (to - from) / span,
      active: pass.aos <= nowMs && pass.los > nowMs,
    };
    const bars = rows.get(pass.satId);
    if (bars) bars.push(bar);
    else rows.set(pass.satId, [bar]);
  }
  return [...rows]
    .map(([satId, bars]) => ({ satId, bars: bars.sort((a, b) => a.pass.aos - b.pass.aos) }))
    .sort((a, b) => a.bars[0]!.pass.aos - b.bars[0]!.pass.aos || a.satId - b.satId);
}

export interface RulerTick {
  /** Fraction of the window. */
  x: number;
  /** Full UTC hour: carries a label. */
  major: boolean;
  /** "HH" for hour ticks (UTC), empty for the quarter-hour minors. */
  label: string;
}

const QUARTER_MS = 15 * 60_000;

/** Ruler ticks every 15 minutes across the window; whole hours are major and labelled in UTC. */
export function rulerTicks(startMs: number, endMs: number): RulerTick[] {
  const span = endMs - startMs;
  const ticks: RulerTick[] = [];
  for (let t = Math.ceil(startMs / QUARTER_MS) * QUARTER_MS; t <= endMs; t += QUARTER_MS) {
    const major = t % 3_600_000 === 0;
    ticks.push({
      x: (t - startMs) / span,
      major,
      label: major ? String(new Date(t).getUTCHours()).padStart(2, '0') : '',
    });
  }
  return ticks;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
