// React hooks over the realtime layer. Subscriptions are ref-counted; data hooks re-render at most
// at their own `hz`, driven by the shared frame loop, never per socket message.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TelemetryFrame } from '@orbitops/shared';
import { onFrame } from './frameLoop.ts';
import { useFleetStore } from './fleetStore.ts';
import type { ConnectionState } from './protocol.ts';
import { realtime } from './client.ts';
import { telemetryStore, type ChartData } from './telemetryStore.ts';
import type { NumericMetric } from './metrics.ts';

/**
 * Subscribes to socket rooms for the lifetime of the component (ref-counted across components).
 * `rooms` should be a stable array or derived from stable values (its content is the dependency).
 * @example useSubscription([satRoom(25544)], 10)
 */
export function useSubscription(rooms: readonly string[], hz = 1): void {
  const key = rooms.join('|');
  useEffect(() => {
    const list = key === '' ? [] : key.split('|');
    return list.length > 0 ? realtime.acquire(list, hz) : undefined;
  }, [key, hz]);
}

export interface ConnectionInfo {
  state: ConnectionState;
  mode: 'live' | 'replay';
  /** Display code for ConnectionBadge. */
  label: 'LIVE' | 'RECONNECTING' | 'OFFLINE' | 'REPLAY';
}

export function useConnection(): ConnectionInfo {
  const state = useFleetStore((s) => s.connection);
  const mode = useFleetStore((s) => s.mode);
  return { state, mode, label: connectionLabel(state, mode) };
}

export function connectionLabel(
  state: ConnectionState,
  mode: 'live' | 'replay',
): ConnectionInfo['label'] {
  if (mode === 'replay') return 'REPLAY';
  if (state === 'live') return 'LIVE';
  if (state === 'offline') return 'OFFLINE';
  return 'RECONNECTING';
}

/**
 * Latest values of a satellite's metrics, re-rendering at most `hz` times per second and only
 * when a value actually changed. Subscribe to the satellite's room separately (useSubscription).
 * @example const { batSoc, panelTempC } = useLatest(satId, ['batSoc', 'panelTempC'], 2);
 */
export function useLatest<M extends keyof TelemetryFrame>(
  satId: number | null,
  metrics: readonly M[],
  hz = 2,
): Partial<Pick<TelemetryFrame, M>> {
  const [values, setValues] = useState<Partial<Pick<TelemetryFrame, M>>>({});
  const metricsKey = metrics.join(',');
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  useEffect(() => {
    if (satId === null) {
      setValues({});
      return;
    }
    let lastVersion = -1;
    return onFrame(
      () => {
        if (telemetryStore.fleetVersion === lastVersion) return;
        lastVersion = telemetryStore.fleetVersion;
        const frame = telemetryStore.latest(satId);
        if (!frame) return;
        setValues((prev) => {
          const next: Partial<Pick<TelemetryFrame, M>> = {};
          let changed = false;
          for (const m of metricsRef.current) {
            next[m] = frame[m] as TelemetryFrame[M];
            if (prev[m] !== next[m]) changed = true;
          }
          return changed ? next : prev;
        });
      },
      { hz },
    );
  }, [satId, metricsKey, hz]);

  return values;
}

/** Chart source: `pull()` returns new data only when something changed (dirty-flag batching). */
export interface ChartSource {
  pull(): ChartData | null;
}

/**
 * Memoised ChartSource over live + history data for one satellite, for StripChart's `source` prop.
 * @param windowS trim to the most recent N seconds (undefined = everything held)
 */
export function useTelemetrySource(
  satId: number,
  metrics: readonly NumericMetric[],
  windowS?: number,
): ChartSource {
  const key = metrics.join(',');
  return useMemo(() => {
    const reader = telemetryStore.reader(satId, metrics);
    // First pull after a (re)creation always delivers data.
    return { pull: () => reader.read(windowS) };
    // `metrics` is represented by `key`.
  }, [satId, key, windowS]);
}
