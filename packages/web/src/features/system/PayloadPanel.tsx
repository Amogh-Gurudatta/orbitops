// PAYLOAD: a live sample of what the server actually broadcasts, and why it is small. Captures one
// decoded delta per second from the fleet feed and compares its encoded size with naive JSON.
import { useEffect, useMemo, useState } from 'react';
import { FIELD_KEYS, type TelemetryFrame } from '@orbitops/shared';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import type { LatestUpdate } from '../../realtime/protocol.ts';
import { telemetryStore } from '../../realtime/telemetryStore.ts';
import { EmptyState, Panel } from '../../ui/index.ts';
import { payloadSizes, savedFraction } from './payload.ts';

interface Captured {
  update: LatestUpdate;
  full: Partial<TelemetryFrame>;
}

const CAPTURE_INTERVAL_MS = 1000;

function useCapturedDelta(): Captured | null {
  const [captured, setCaptured] = useState<Captured | null>(null);
  useEffect(() => {
    let last = 0;
    return telemetryStore.onBatch((updates) => {
      const now = Date.now();
      if (now - last < CAPTURE_INTERVAL_MS) return;
      const update = updates.find((u) => Object.keys(u.frame).length > 0);
      if (!update) return;
      last = now;
      setCaptured({ update, full: { ...telemetryStore.latest(update.satId) } });
    });
  }, []);
  return captured;
}

function SizeBar({
  label,
  bytes,
  max,
  strong,
}: {
  label: string;
  bytes: number;
  max: number;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)_56px] items-center gap-x-1">
      <span className="mnemonic truncate text-xs text-text-2">{label}</span>
      <div className="h-1 bg-grid">
        <div
          className={strong ? 'h-full bg-text' : 'h-full bg-text-dim'}
          style={{ width: `${(bytes / max) * 100}%` }}
        />
      </div>
      <span className="num text-right text-xs text-text">{bytes} B</span>
    </div>
  );
}

export function PayloadPanel() {
  const captured = useCapturedDelta();
  const catalog = useFleetStore((s) => s.catalog);
  const sizes = useMemo(
    () => (captured ? payloadSizes(captured.update, captured.full) : null),
    [captured],
  );

  return (
    <Panel
      title="PAYLOAD"
      subtitle="WHAT ONE BROADCAST LOOKS LIKE"
      flush
      bodyClassName="flex flex-col overflow-auto"
    >
      {!captured || !sizes ? (
        <EmptyState title="WAITING FOR A DELTA" detail="Appears with the next fleet update." />
      ) : (
        <>
          <p className="mnemonic border-b border-grid px-1 py-0.5 text-xs text-text-2">
            SAT {captured.update.satId} {catalog[captured.update.satId]?.name} · SEQ{' '}
            {captured.update.seq}
          </p>
          <pre className="num max-h-24 overflow-auto border-b border-grid px-1 py-0.5 text-xs leading-[16px] text-text">
            {Object.entries(captured.update.frame)
              .map(([field, value]) => {
                const key = FIELD_KEYS[field as keyof typeof FIELD_KEYS];
                return `${key.padEnd(3)} ${field.padEnd(11)} ${JSON.stringify(value)}`;
              })
              .join('\n')}
          </pre>
          <div className="flex flex-col gap-0.5 p-1">
            <SizeBar label="MSGPACK DELTA" bytes={sizes.compactDelta} max={sizes.jsonFull} strong />
            <SizeBar label="JSON DELTA" bytes={sizes.jsonDelta} max={sizes.jsonFull} />
            <SizeBar label="JSON FULL FRAME" bytes={sizes.jsonFull} max={sizes.jsonFull} />
            <p className="mnemonic pt-0.5 text-xs text-text-2">
              <span className="num text-text">
                {(savedFraction(sizes.compactDelta, sizes.jsonFull) * 100).toFixed(0)} %
              </span>{' '}
              SMALLER THAN NAIVE JSON
            </p>
          </div>
        </>
      )}
      <p className="px-1 pb-1 text-xs text-text-2">
        Only changed fields travel, under 1-2 character keys with fixed rounding,
        MessagePack-encoded end to end. The full frame is what a plain JSON broadcast would send
        every sample.
      </p>
    </Panel>
  );
}
