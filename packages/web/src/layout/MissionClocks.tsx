// UTC and MET (mission elapsed time) segmented clocks, driven by the estimated server clock.
import { useEffect, useState } from 'react';
import { MISSION_EPOCH_MS } from '../config.ts';
import { serverNow } from '../realtime/clock.ts';
import { SegmentDisplay } from '../ui/index.ts';

const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, '0');

export function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** DDD:HH:MM:SS elapsed since the mission epoch. */
export function formatMet(ms: number): string {
  const total = Math.max(0, Math.floor((ms - MISSION_EPOCH_MS) / 1000));
  const days = Math.floor(total / 86_400);
  const rest = total % 86_400;
  return `${pad(days, 3)}:${pad(rest / 3600)}:${pad((rest % 3600) / 60)}:${pad(rest % 60)}`;
}

/** Re-renders once per second, aligned to the wall-clock second boundary. */
function useSecondTick(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(serverNow());
      timer = setTimeout(tick, 1000 - (serverNow() % 1000) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

export function MissionClocks({ showMet = true }: { showMet?: boolean }) {
  const now = useSecondTick();
  return (
    <div className="flex items-center gap-2">
      <SegmentDisplay label="UTC" value={formatUtc(now)} />
      {showMet && <SegmentDisplay label="MET" value={formatMet(now)} />}
    </div>
  );
}
