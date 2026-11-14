// Row model for the fleet table, refreshed at 2 Hz from the telemetry store. Rows whose displayed values did not
// change keep their object identity, so memoised table rows skip rendering.
import { useEffect, useState } from 'react';
import type { SatGroup } from '@orbitops/shared';
import { onFrame } from '../../realtime/frameLoop.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import type { SatStatus } from '../../realtime/status.ts';
import { telemetryStore } from '../../realtime/telemetryStore.ts';

export interface FleetRowData {
  satId: number;
  name: string;
  group: SatGroup;
  mode: string | null;
  /** State of charge, 0..1. */
  batSoc: number | null;
  solarW: number | null;
  panelTempC: number | null;
  /** Ground station currently in contact, or null. */
  stationId: string | null;
  altKm: number | null;
  /** Seconds since the last frame arrived; null before the first one. */
  ageS: number | null;
  status: SatStatus;
}

const ROW_HZ = 2;

const sameRow = (a: FleetRowData, b: FleetRowData) =>
  a.status === b.status &&
  a.mode === b.mode &&
  a.batSoc === b.batSoc &&
  a.solarW === b.solarW &&
  a.panelTempC === b.panelTempC &&
  a.stationId === b.stationId &&
  a.altKm === b.altKm &&
  a.ageS === b.ageS &&
  a.name === b.name;

export function buildRows(
  catalog: ReturnType<typeof useFleetStore.getState>['catalog'],
  status: ReturnType<typeof useFleetStore.getState>['status'],
  now: number,
  previous: ReadonlyMap<number, FleetRowData>,
): FleetRowData[] {
  return Object.values(catalog).map((sat) => {
    const frame = telemetryStore.latest(sat.satId);
    const seenAt = telemetryStore.lastSeenAt(sat.satId);
    const next: FleetRowData = {
      satId: sat.satId,
      name: sat.name,
      group: sat.group,
      mode: frame?.mode ?? null,
      batSoc: frame?.batSoc ?? null,
      solarW: frame?.solarW ?? null,
      panelTempC: frame?.panelTempC ?? null,
      stationId: frame?.stationId ?? null,
      altKm: frame?.altKm ?? null,
      ageS: seenAt === undefined ? null : Math.max(0, Math.floor((now - seenAt) / 1000)),
      status: status[sat.satId] ?? 'NOM',
    };
    const before = previous.get(sat.satId);
    return before && sameRow(before, next) ? before : next;
  });
}

export function useFleetRows(): FleetRowData[] {
  const [rows, setRows] = useState<FleetRowData[]>([]);

  useEffect(() => {
    let previous = new Map<number, FleetRowData>();
    return onFrame(
      () => {
        const { catalog, status } = useFleetStore.getState();
        const next = buildRows(catalog, status, Date.now(), previous);
        const unchanged =
          next.length === previous.size && next.every((row) => previous.get(row.satId) === row);
        if (unchanged) return;
        previous = new Map(next.map((row) => [row.satId, row]));
        setRows(next);
      },
      { hz: ROW_HZ },
    );
  }, []);

  return rows;
}
