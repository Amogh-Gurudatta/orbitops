// React-facing state that changes rarely: connection, selection, satellite catalogue, per-satellite
// status (published at most 2 Hz by the sweeper) and pipeline/latency stats. High-rate telemetry
// lives in telemetryStore, not here.
import { create } from 'zustand';
import { STALE_AFTER_MS, STATUS_PUBLISH_INTERVAL_MS } from '../config.ts';
import type { PipelineStats, Satellite } from '../api/types.ts';
import { useAlertsStore } from './alertsStore.ts';
import { classifyStatus, fromServerStatus, type SatStatus } from './status.ts';
import { telemetryStore } from './telemetryStore.ts';
import type { ConnectionState, LatencyStats } from './protocol.ts';

export type DataMode = 'live' | 'replay';

interface FleetState {
  connection: ConnectionState;
  mode: DataMode;
  selectedSatId: number | null;
  catalog: Record<number, Satellite>;
  status: Record<number, SatStatus>;
  latency: LatencyStats | null;
  pipeline: PipelineStats | null;
  setConnection(state: ConnectionState): void;
  setMode(mode: DataMode): void;
  selectSat(satId: number | null): void;
  setCatalog(satellites: readonly Satellite[]): void;
  setLatency(stats: LatencyStats): void;
  setPipeline(stats: PipelineStats): void;
  setStatuses(status: Record<number, SatStatus>): void;
  reset(): void;
}

export const useFleetStore = create<FleetState>()((set) => ({
  connection: 'connecting',
  mode: 'live',
  selectedSatId: null,
  catalog: {},
  status: {},
  latency: null,
  pipeline: null,
  setConnection: (connection) => set({ connection }),
  setMode: (mode) => set({ mode }),
  selectSat: (selectedSatId) => set({ selectedSatId }),
  setCatalog: (satellites) =>
    set((state) => ({
      catalog: Object.fromEntries(satellites.map((s) => [s.satId, s])),
      // Seed status from the server so the table is meaningful before the first sweep.
      status: {
        ...Object.fromEntries(satellites.map((s) => [s.satId, fromServerStatus(s.status)])),
        ...state.status,
      },
    })),
  setLatency: (latency) => set({ latency }),
  setPipeline: (pipeline) => set({ pipeline }),
  setStatuses: (status) => set({ status }),
  reset: () =>
    set({
      connection: 'connecting',
      selectedSatId: null,
      catalog: {},
      status: {},
      latency: null,
      pipeline: null,
    }),
}));

/** Recomputes every satellite's status from alerts + data freshness. Returns null if nothing changed. */
export function computeStatuses(
  catalog: Record<number, Satellite>,
  previous: Record<number, SatStatus>,
  now: number,
): Record<number, SatStatus> | null {
  const worst = useAlertsStore.getState().summary.worstBySat;
  const next: Record<number, SatStatus> = {};
  let changed = false;
  for (const key of Object.keys(catalog)) {
    const satId = Number(key);
    next[satId] = classifyStatus({
      lastSeenAt: telemetryStore.lastSeenAt(satId),
      now,
      worstSeverity: worst[satId] ?? null,
      staleAfterMs: STALE_AFTER_MS,
    });
    if (previous[satId] !== next[satId]) changed = true;
  }
  return changed ? next : null;
}

/** Starts the 2 Hz status sweeper; returns its stop function. */
export function startStatusSweeper(): () => void {
  const timer = setInterval(() => {
    const { catalog, status, setStatuses } = useFleetStore.getState();
    const next = computeStatuses(catalog, status, Date.now());
    if (next) setStatuses(next);
  }, STATUS_PUBLISH_INTERVAL_MS);
  return () => clearInterval(timer);
}
