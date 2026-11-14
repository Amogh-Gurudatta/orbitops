// Main-thread facade over the socket worker: starts it, routes its callbacks into the stores,
// and owns ref-counted subscriptions. UI code uses the hooks in useRealtime.ts rather than this directly.
import * as Comlink from 'comlink';
import { api } from '../api/client.ts';
import { fetchOpenAlerts } from '../api/endpoints.ts';
import { handleIncomingAlert } from './alertEffects.ts';
import { useAlertsStore } from './alertsStore.ts';
import { setClockOffset } from './clock.ts';
import { useFleetStore } from './fleetStore.ts';
import type { ConnectionState, SocketWorkerApi, WorkerEvents, WorkerStats } from './protocol.ts';
import { SubscriptionManager } from './subscriptionManager.ts';
import { telemetryStore } from './telemetryStore.ts';

type Remote = Comlink.Remote<SocketWorkerApi>;

class RealtimeClient {
  private worker: Worker | null = null;
  private remote: Remote | null = null;
  private readonly subscriptions = new SubscriptionManager();
  /** Watermarks reported before the worker exists are replayed on start. */
  private readonly pendingWatermarks = new Map<number, number>();
  private lastConnection: ConnectionState = 'connecting';
  private refreshing = false;

  constructor() {
    telemetryStore.setWatermarkSink((satId, lastSeq) => this.setHistoryWatermark(satId, lastSeq));
  }

  /** Spawns the worker and connects both sockets. Idempotent. */
  start(): void {
    if (this.remote) return;
    this.lastConnection = 'connecting';
    this.worker = new Worker(new URL('./socket.worker.ts', import.meta.url), { type: 'module' });
    this.remote = Comlink.wrap<SocketWorkerApi>(this.worker);
    const remote = this.remote;

    void remote.connect(Comlink.proxy(this.handlers()));
    for (const [satId, seq] of this.pendingWatermarks) void remote.setHistoryWatermark(satId, seq);
    this.pendingWatermarks.clear();
    this.subscriptions.attach({
      subscribe: (rooms, hz) => void remote.subscribe(rooms, hz),
      unsubscribe: (rooms) => void remote.unsubscribe(rooms),
    });
  }

  /** Terminates the worker (both sockets). Stores keep their data until reset(). */
  stop(): void {
    this.subscriptions.attach(null);
    this.worker?.terminate();
    this.worker = null;
    this.remote = null;
  }

  /** Clears every realtime store (logout, so the next user never sees the previous session's data). */
  reset(): void {
    telemetryStore.reset();
    useAlertsStore.getState().reset();
    useFleetStore.getState().reset();
  }

  /** Ref-counted room subscription; call the returned function to release. */
  acquire(rooms: readonly string[], hz: number): () => void {
    return this.subscriptions.acquire(rooms, hz);
  }

  /** Live events for the satellite with seq <= lastSeq are dropped by the worker. */
  setHistoryWatermark(satId: number, lastSeq: number): void {
    if (this.remote) void this.remote.setHistoryWatermark(satId, lastSeq);
    else this.pendingWatermarks.set(satId, lastSeq);
  }

  async stats(): Promise<WorkerStats | null> {
    return this.remote ? this.remote.getStats() : null;
  }

  private handlers(): WorkerEvents {
    return {
      onBatch: (batch) => telemetryStore.applyBatch(batch),
      onConnection: (state) => this.handleConnection(state),
      onAlert: handleIncomingAlert,
      onServerStats: (stats) => useFleetStore.getState().setPipeline(stats),
      onLatency: (stats) => {
        setClockOffset(stats.offsetMs);
        useFleetStore.getState().setLatency(stats);
      },
    };
  }

  private handleConnection(state: ConnectionState): void {
    useFleetStore.getState().setConnection(state);
    if (state === 'live' && this.lastConnection !== 'live') void this.resyncAlerts();
    this.lastConnection = state;
    if (state === 'unauthorized') void this.renewSession();
  }

  /** The handshake was refused: refresh the access cookie once, then reconnect. */
  private async renewSession(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      if (await api.refresh()) await this.remote?.reconnect();
      else useFleetStore.getState().setConnection('offline');
    } finally {
      this.refreshing = false;
    }
  }

  /** After (re)connecting, REST is the source of truth for alerts missed while offline. */
  private async resyncAlerts(): Promise<void> {
    try {
      useAlertsStore.getState().replaceAll(await fetchOpenAlerts());
    } catch {
      // Live ALERT_UPDATE messages keep the store usable; the next reconnect retries.
    }
  }
}

export const realtime = new RealtimeClient();
