// Small React hooks for the satellite page: a ticking clock and the live data age of a satellite.
import { useEffect, useState } from 'react';
import { telemetryStore } from '../../realtime/telemetryStore.ts';

/** Wall-clock ms, re-rendering the caller every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Seconds since the last frame arrived for the satellite (null before the first one). */
export function useDataAgeS(satId: number): number | null {
  const now = useNow(500);
  const seenAt = telemetryStore.lastSeenAt(satId);
  return seenAt === undefined ? null : Math.max(0, (now - seenAt) / 1000);
}
