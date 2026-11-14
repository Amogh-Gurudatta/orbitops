// Data access for the replay page: the 6 h history window (chunked raw requests) and alert markers.
import type { Alert } from '@orbitops/shared';
import { api } from '../../api/client.ts';
import { fetchHistory } from '../../api/endpoints.ts';
import type { TelemetryHistory } from '../../api/types.ts';
import { joinHistories } from './coverage.ts';
import { HOUR_MS, type TimeSpan } from './timeline.ts';

/** Metrics replayed: three charts plus the readout list. */
export const REPLAY_METRICS = [
  'batSoc',
  'panelTempC',
  'solarW',
  'busA',
  'obcTempC',
  'rssiDbm',
] as const;

/** The server serves raw telemetry for spans up to two hours; longer spans are 1-minute rollups. */
const RAW_CHUNK_MS = 2 * HOUR_MS;
const POINTS_PER_CHUNK = 700;

/** Splits [from, to] into consecutive chunks no longer than the raw limit. */
export function chunkSpan({ from, to }: TimeSpan, chunkMs = RAW_CHUNK_MS): TimeSpan[] {
  const chunks: TimeSpan[] = [];
  for (let start = from; start < to; start += chunkMs) {
    chunks.push({ from: start, to: Math.min(to, start + chunkMs) });
  }
  return chunks;
}

export interface ReplayHistory {
  /** Epoch ms ascending. */
  t: number[];
  series: Record<string, (number | null)[]>;
}

/** Whole window for one satellite in full raw resolution (about 2000 points in total). */
export async function fetchReplayHistory(
  satId: number,
  span: TimeSpan,
  signal?: AbortSignal,
): Promise<ReplayHistory> {
  const chunks: TelemetryHistory[] = await Promise.all(
    chunkSpan(span).map((c) =>
      fetchHistory({
        satId,
        from: c.from,
        to: c.to,
        metrics: REPLAY_METRICS,
        maxPoints: POINTS_PER_CHUNK,
        signal,
      }),
    ),
  );
  return joinHistories(chunks, REPLAY_METRICS);
}

export const fetchAlertMarkers = () =>
  api.get<{ alerts: Alert[] }>('/alerts', { query: { limit: 500 } }).then((r) => r.alerts);

export const replayKeys = {
  history: (satId: number, from: number, to: number) =>
    ['replay-history', satId, from, to] as const,
  alerts: ['replay-alerts'] as const,
};
