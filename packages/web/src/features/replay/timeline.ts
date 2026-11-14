// Pure geometry and tick logic for the replay timeline ruler: time <-> pixel mapping, hour/10-minute
// ticks on UTC boundaries, and playhead stepping.

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;
export const MINOR_TICK_MS = 10 * MINUTE_MS;

export interface TimeSpan {
  from: number;
  to: number;
}

export interface Tick {
  t: number;
  major: boolean;
  /** UTC "HH:MM" label, majors only. */
  label?: string;
}

export const clampTime = (t: number, { from, to }: TimeSpan): number =>
  Math.min(to, Math.max(from, t));

export function timeToX(t: number, span: TimeSpan, width: number): number {
  return ((t - span.from) / (span.to - span.from)) * width;
}

/** Inverse of timeToX, clamped to the span. */
export function xToTime(x: number, span: TimeSpan, width: number): number {
  return clampTime(span.from + (x / width) * (span.to - span.from), span);
}

/** "HH:MM" in UTC. */
export function utcHourMinute(t: number): string {
  return new Date(t).toISOString().slice(11, 16);
}

/** Ticks every `minorMs` aligned to UTC multiples; every full hour is major and labelled. */
export function generateTicks(span: TimeSpan, minorMs = MINOR_TICK_MS): Tick[] {
  const ticks: Tick[] = [];
  const first = Math.ceil(span.from / minorMs) * minorMs;
  for (let t = first; t <= span.to; t += minorMs) {
    const major = t % HOUR_MS === 0;
    ticks.push(major ? { t, major, label: utcHourMinute(t) } : { t, major });
  }
  return ticks;
}

export const SPEEDS = [1, 10, 60, 300] as const;
export type Speed = (typeof SPEEDS)[number];

/** Moves the playhead by `deltaMs`, clamped to the span. */
export const stepTime = (t: number, deltaMs: number, span: TimeSpan): number =>
  clampTime(t + deltaMs, span);

/** Advances the playhead by wall-clock `dtMs` at `speed`; `ended` is true once it reaches the span end. */
export function advancePlayhead(
  t: number,
  dtMs: number,
  speed: number,
  span: TimeSpan,
): { t: number; ended: boolean } {
  const next = t + dtMs * speed;
  return next >= span.to ? { t: span.to, ended: true } : { t: next, ended: false };
}
