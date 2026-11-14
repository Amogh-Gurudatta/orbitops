// Typed helpers for the endpoints the shell and realtime layer use. Page agents add theirs beside these
// or call `api` directly; query keys live in `queryKeys` so cache invalidation stays consistent.
import type { Alert } from '@orbitops/shared';
import { api } from './client.ts';
import type { GroundStation, Pass, Satellite, TelemetryHistory } from './types.ts';

export const queryKeys = {
  me: ['auth', 'me'] as const,
  satellites: ['satellites'] as const,
  stations: ['ground-stations'] as const,
  passes: (satId: number, hours: number, stationId?: string) =>
    ['passes', satId, hours, stationId ?? null] as const,
  history: (satId: number, from: number, to: number, metrics: string, maxPoints: number) =>
    ['telemetry', satId, from, to, metrics, maxPoints] as const,
};

export const fetchSatellites = () =>
  api.get<{ satellites: Satellite[] }>('/satellites').then((r) => r.satellites);

export const fetchStations = () =>
  api.get<{ stations: GroundStation[] }>('/ground-stations').then((r) => r.stations);

export const fetchOpenAlerts = () =>
  api.get<{ alerts: Alert[] }>('/alerts', { query: { limit: 200 } }).then((r) => r.alerts);

export interface HistoryRequest {
  satId: number;
  /** Epoch ms. */
  from: number;
  to: number;
  metrics: readonly string[];
  maxPoints?: number;
  signal?: AbortSignal;
}

export const fetchHistory = ({
  satId,
  from,
  to,
  metrics,
  maxPoints = 1000,
  signal,
}: HistoryRequest) =>
  api.get<TelemetryHistory>('/telemetry', {
    query: { satId, from, to, metrics: metrics.join(','), maxPoints },
    signal,
  });

/** Upcoming visibility windows of one satellite over all stations (or one), soonest first. */
export const fetchPasses = (
  satId: number,
  hours: number,
  stationId?: string,
  signal?: AbortSignal,
) =>
  api
    .get<{ passes: Pass[] }>('/passes', { query: { satId, hours, stationId }, signal })
    .then((r) => r.passes);

/** Acknowledges an alert (operator+); resolves to the updated alert for the store. */
export const ackAlert = (alertId: string) =>
  api.post<{ alert: Alert }>(`/alerts/${encodeURIComponent(alertId)}/ack`).then((r) => r.alert);
