// Pass list logic: classify each predicted pass against "now" and format countdowns.
import type { Pass } from '../../api/types.ts';

export type PassPhase = 'active' | 'next' | 'upcoming' | 'past';

/** The first pass that has not started is NEXT; one already underway is ACTIVE. */
export function classifyPasses(passes: readonly Pass[], now: number): PassPhase[] {
  let nextAssigned = false;
  return passes.map((pass) => {
    if (pass.los <= now) return 'past';
    if (pass.aos <= now) return 'active';
    if (!nextAssigned) {
      nextAssigned = true;
      return 'next';
    }
    return 'upcoming';
  });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "mm:ss", or "h:mm:ss" from one hour up. Negative input is clamped to zero. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** AOS cell: T-countdown before the pass, time remaining to LOS during it. */
export function passCountdown(pass: Pass, now: number): string {
  if (now >= pass.aos && now < pass.los) return `LOS ${formatClock(pass.los - now)}`;
  return `T−${formatClock(pass.aos - now)}`;
}

/** Pass duration as "m:ss". */
export function formatDuration(pass: Pass): string {
  const total = Math.round((pass.los - pass.aos) / 1000);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/** "HH:MM:SSZ" in UTC. */
export function formatUtcTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19) + 'Z';
}
