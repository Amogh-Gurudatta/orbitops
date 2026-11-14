// One-line pipeline health: ingest rate, broadcast rate, clients, end-to-end latency and the defence counters.
// Rendered as dense readouts, not tiles. Values come from the server's 1 Hz SERVER_STATS feed.
import { SYSTEM_ROOM } from '@orbitops/shared';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { useSubscription } from '../../realtime/useRealtime.ts';
import { Readout } from '../../ui/index.ts';

export function PipelineStrip() {
  useSubscription([SYSTEM_ROOM], 1);
  const stats = useFleetStore((s) => s.pipeline);

  if (!stats) {
    return (
      <p className="mnemonic flex h-full items-center px-1 text-xs text-text-2">
        ACQUIRING PIPELINE STATS…
      </p>
    );
  }

  const { ingest, broadcast, clients, latency } = stats;
  const cells = [
    { label: 'EV/S IN', value: ingest.eventsPerSec, decimals: 0 },
    { label: 'MSG/S OUT', value: broadcast.msgsPerSec, decimals: 0 },
    { label: 'CLIENTS', value: clients.telemetry + clients.alerts, decimals: 0 },
    { label: 'E2E P95', value: latency.p95, unit: 'ms', decimals: 0, caution: latency.p95 > 250 },
    { label: 'DUP', value: ingest.duplicates, decimals: 0 },
    { label: 'OOO', value: ingest.outOfOrder, decimals: 0 },
    { label: 'MALF', value: ingest.malformed, decimals: 0 },
    { label: 'DROP', value: ingest.dropped, decimals: 0, caution: ingest.dropped > 0 },
  ];

  return (
    <div className="flex h-full items-center overflow-x-auto overflow-y-hidden">
      {cells.map((c) => (
        <Readout
          key={c.label}
          label={c.label}
          value={c.value}
          unit={c.unit}
          decimals={c.decimals}
          state={c.caution ? 'caution' : 'nominal'}
          className="min-w-[136px] flex-1 border-b-0 border-r"
        />
      ))}
    </div>
  );
}
