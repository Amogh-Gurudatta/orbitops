// UTC timestamp formatting for dense tables (the console runs on UTC, never local time).

const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:MM:SS` */
export function formatUtcTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** `MM-DD HH:MM:SS` */
export function formatUtcDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${formatUtcTime(ms)}`;
}

/** `YYYY-MM-DD HH:MM:SS` */
export function formatUtcFull(ms: number): string {
  return `${new Date(ms).getUTCFullYear()}-${formatUtcDateTime(ms)}`;
}

/** `HH:MM`, or `MM-DD HH:MM` when `withDate` is set. */
export function formatUtcClock(ms: number, withDate = false): string {
  const d = new Date(ms);
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return withDate ? `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${clock}` : clock;
}
