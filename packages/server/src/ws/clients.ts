// Per-connection state for /telemetry clients: requested rate, subscribed satellites, throttle buffer and
// slow-consumer status. The registry also keeps the id sets the broadcaster excludes from room emits.
import type { Socket } from 'socket.io';
import { BROADCAST_HZ, type TmDelta } from '@orbitops/shared';

export interface TelemetryClient {
  socket: Socket;
  hz: number;
  /** Satellites in the client's `sat:*` rooms (mirrors socket.rooms for fast lookup). */
  sats: Set<number>;
  /** Merged deltas waiting for this client's next (slower) emit. */
  pending: Map<number, TmDelta>;
  lastEmitAt: number;
  slow: boolean;
  slowSince: number | null;
}

export class ClientRegistry {
  private readonly clients = new Map<string, TelemetryClient>();
  /** Clients that must not get `sat:*` room emits: they receive per-socket throttled batches instead. */
  private readonly lowRate = new Set<string>();
  private readonly slow = new Set<string>();

  add(socket: Socket): TelemetryClient {
    const client: TelemetryClient = {
      socket,
      hz: BROADCAST_HZ,
      sats: new Set(),
      pending: new Map(),
      lastEmitAt: 0,
      slow: false,
      slowSince: null,
    };
    this.clients.set(socket.id, client);
    return client;
  }

  remove(socketId: string): void {
    this.clients.delete(socketId);
    this.lowRate.delete(socketId);
    this.slow.delete(socketId);
  }

  setHz(client: TelemetryClient, hz: number): void {
    client.hz = hz;
    this.reindex(client);
  }

  setSlow(client: TelemetryClient, slow: boolean, now: number): void {
    client.slow = slow;
    client.slowSince = slow ? now : null;
    if (slow) client.pending.clear();
    this.reindex(client);
  }

  private reindex(client: TelemetryClient): void {
    const id = client.socket.id;
    if (client.slow) this.slow.add(id);
    else this.slow.delete(id);
    if (client.slow || client.hz < BROADCAST_HZ) this.lowRate.add(id);
    else this.lowRate.delete(id);
  }

  values(): IterableIterator<TelemetryClient> {
    return this.clients.values();
  }

  get(socketId: string): TelemetryClient | undefined {
    return this.clients.get(socketId);
  }

  lowRateClients(): TelemetryClient[] {
    return [...this.lowRate].map((id) => this.clients.get(id)).filter((c) => c !== undefined);
  }

  get lowRateIds(): ReadonlySet<string> {
    return this.lowRate;
  }

  get slowIds(): ReadonlySet<string> {
    return this.slow;
  }

  get slowCount(): number {
    return this.slow.size;
  }

  get size(): number {
    return this.clients.size;
  }
}
