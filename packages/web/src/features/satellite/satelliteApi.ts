// REST helpers specific to the satellite detail page: banded history, passes, commands and alert actions.
// (History without bands is `fetchHistory` in api/endpoints.ts.)
import type { Alert, Command } from '@orbitops/shared';
import { api } from '../../api/client.ts';
import type { CommandRecord, Pass, TelemetryHistory } from '../../api/types.ts';

export const satelliteKeys = {
  history: (satId: number, range: string, metrics: string) =>
    ['sat-history', satId, range, metrics] as const,
  passes: (satId: number) => ['passes', satId] as const,
  commands: (satId: number) => ['commands', satId] as const,
};

export interface BandedHistoryRequest {
  satId: number;
  from: number;
  to: number;
  metrics: readonly string[];
  maxPoints: number;
  /** Rollup ranges can also return `${metric}:min` / `${metric}:max` columns. */
  bands: boolean;
  signal?: AbortSignal;
}

export const fetchBandedHistory = ({ metrics, bands, ...rest }: BandedHistoryRequest) =>
  api.get<TelemetryHistory>('/telemetry', {
    query: {
      satId: rest.satId,
      from: rest.from,
      to: rest.to,
      metrics: metrics.join(','),
      maxPoints: rest.maxPoints,
      bands: bands ? 1 : 0,
    },
    signal: rest.signal,
  });

export const fetchPasses = (satId: number, hours = 12) =>
  api.get<{ passes: Pass[] }>('/passes', { query: { satId, hours } }).then((r) => r.passes);

export const fetchCommands = (satId: number) =>
  api.get<{ commands: CommandRecord[] }>('/commands', { query: { satId } }).then((r) => r.commands);

export const sendCommand = (command: Command) =>
  api.post<{ command: CommandRecord }>('/commands', command).then((r) => r.command);

export const ackAlertById = (id: string) =>
  api.post<{ alert: Alert }>(`/alerts/${id}/ack`).then((r) => r.alert);

export const resolveAlertById = (id: string) =>
  api.post<{ alert: Alert }>(`/alerts/${id}/resolve`).then((r) => r.alert);
