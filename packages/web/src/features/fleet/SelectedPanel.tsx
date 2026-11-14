// Compact readout block for the selected satellite: live values at 5 Hz plus the countdown to its next pass.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { satRoom } from '@orbitops/shared';
import { fetchPasses, queryKeys } from '../../api/endpoints.ts';
import type { Pass } from '../../api/types.ts';
import { serverNow } from '../../realtime/clock.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { useLatest, useSubscription } from '../../realtime/useRealtime.ts';
import { Button, Readout, StatusChip } from '../../ui/index.ts';
import { limitState } from './limits.ts';

const PASS_HOURS = 6;

/** "T-12:05" / "T-1:02:05" style countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The pass in progress, else the next one. */
export function currentOrNextPass(passes: readonly Pass[], now: number): Pass | undefined {
  return passes.find((p) => p.los > now);
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function PassReadout({ satId }: { satId: number }) {
  const now = useNow(1000);
  const query = useQuery({
    queryKey: queryKeys.passes(satId, PASS_HOURS),
    queryFn: ({ signal }) => fetchPasses(satId, PASS_HOURS, undefined, signal),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  if (query.isPending) return <Readout label="NEXT AOS" value="ACQUIRING…" />;
  if (query.isError) return <Readout label="NEXT AOS" value="ERR" state="stale" />;
  const pass = currentOrNextPass(query.data, now);
  if (!pass) return <Readout label="NEXT AOS" value={`>${PASS_HOURS}H`} />;
  const inPass = pass.aos <= now;
  return (
    <Readout
      label={inPass ? `LOS ${pass.stationId}` : `AOS ${pass.stationId}`}
      value={`T-${formatCountdown((inPass ? pass.los : pass.aos) - now)}`}
    />
  );
}

export function SelectedPanel({ satId }: { satId: number }) {
  const navigate = useNavigate();
  useSubscription([satRoom(satId)], 5);
  const sat = useFleetStore((s) => s.catalog[satId]);
  const status = useFleetStore((s) => s.status[satId]) ?? 'NOM';
  const v = useLatest(
    satId,
    [
      'batSoc',
      'solarW',
      'busA',
      'panelTempC',
      'obcTempC',
      'rssiDbm',
      'elevDeg',
      'attRateDps',
      'mode',
    ],
    5,
  );
  const stale = status === 'STALE';
  const st = <M extends Parameters<typeof limitState>[0]>(
    m: M,
    value: number | null | undefined,
  ) => (stale ? 'stale' : limitState(m, value));

  return (
    <div className="@container flex h-full min-h-0 flex-col overflow-auto">
      <div className="flex h-3 shrink-0 items-center gap-1 border-b border-grid px-1">
        <span className="min-w-0 flex-1 truncate text-sm text-text">{sat?.name ?? satId}</span>
        <span className="num text-xs text-text-dim">{satId}</span>
        <StatusChip status={status} />
        <Button size="sm" variant="primary" onClick={() => navigate(`/sat/${satId}`)}>
          OPEN ▸
        </Button>
      </div>
      <div className="grid grid-cols-1 @min-[420px]:grid-cols-2">
        <Readout
          label="BATT"
          unit="%"
          value={v.batSoc === undefined ? undefined : v.batSoc * 100}
          state={st('batSoc', v.batSoc)}
        />
        <Readout
          label="SA W"
          unit="W"
          decimals={0}
          value={v.solarW}
          state={stale ? 'stale' : 'nominal'}
        />
        <Readout label="BUS A" unit="A" decimals={2} value={v.busA} state={st('busA', v.busA)} />
        <Readout
          label="PNL T"
          unit="°C"
          value={v.panelTempC}
          state={st('panelTempC', v.panelTempC)}
        />
        <Readout label="OBC T" unit="°C" value={v.obcTempC} state={st('obcTempC', v.obcTempC)} />
        <Readout label="RSSI" unit="dBm" value={v.rssiDbm} state={st('rssiDbm', v.rssiDbm)} />
        <Readout label="ELEV" unit="°" value={v.elevDeg} state={stale ? 'stale' : 'nominal'} />
        <Readout
          label="ATT RATE"
          unit="°/s"
          decimals={2}
          value={v.attRateDps}
          state={st('attRateDps', v.attRateDps)}
        />
        <Readout label="MODE" value={v.mode ?? undefined} state={stale ? 'stale' : 'nominal'} />
        <PassReadout satId={satId} />
      </div>
    </div>
  );
}
