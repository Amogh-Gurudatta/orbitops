// Server-clock estimate shared across the UI. The worker measures the offset (NTP midpoint);
// everything that shows "now" in mission terms should read serverNow() rather than Date.now().
let offsetMs = 0;

export function setClockOffset(ms: number): void {
  offsetMs = ms;
}

export function clockOffset(): number {
  return offsetMs;
}

/** Epoch ms on the server's clock (best estimate). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
