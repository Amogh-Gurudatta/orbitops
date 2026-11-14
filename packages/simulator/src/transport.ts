// Socket.IO transport to the server's /ingest namespace: per-source batching, acks, backpressure,
// bounded buffering across disconnects, and receipt of COMMAND / 'chaos' messages.
import {
  ChaosConfig,
  Command,
  COMMAND,
  IngestAck,
  INGEST_BATCH,
  INGEST_BATCH_INTERVAL_MS,
  MAX_EVENTS_PER_BATCH,
  NS_INGEST,
  socketParser,
  type TelemetryEvent,
} from '@orbitops/shared';
import { io, type Socket } from 'socket.io-client';
import { Chaos } from './chaos.js';

export const ACK_TIMEOUT_MS = 2_000;
export const MAX_BUFFER_PER_SOURCE = 200;
/** Pause applied when the server answers ok:false without a retryAfterMs. */
const DEFAULT_RETRY_MS = 1_000;
const CHAOS_EVENT = 'chaos';

export interface TransportStats {
  eventsSent: number;
  acksOk: number;
  acksRejected: number;
  ackTimeouts: number;
  dropped: number;
  /** Per-event outcomes reported by the server in successful acks. */
  accepted: number;
  duplicates: number;
  rejected: number;
}

export interface TransportOptions {
  serverUrl: string;
  apiKey: string;
  chaos: Chaos;
  onCommand: (command: Command) => void;
  now?: () => number;
}

interface SourceState {
  buffer: TelemetryEvent[];
  pausedUntil: number;
  inFlight: boolean;
}

export class IngestTransport {
  readonly stats: TransportStats = {
    eventsSent: 0,
    acksOk: 0,
    acksRejected: 0,
    ackTimeouts: 0,
    dropped: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
  };
  private readonly socket: Socket;
  private readonly sources = new Map<string, SourceState>();
  private readonly now: () => number;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: TransportOptions) {
    this.now = options.now ?? Date.now;
    this.socket = io(`${options.serverUrl}${NS_INGEST}`, {
      parser: socketParser,
      transports: ['websocket'],
      auth: { apiKey: options.apiKey },
    });
    this.socket.on(COMMAND, (payload: unknown) => {
      const parsed = Command.safeParse(payload);
      if (parsed.success) options.onCommand(parsed.data);
    });
    this.socket.on(CHAOS_EVENT, (payload: unknown) => {
      const parsed = ChaosConfig.safeParse(payload);
      if (parsed.success) options.chaos.configure(parsed.data);
    });
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  /** Events waiting to be (re)sent across all sources. */
  get buffered(): number {
    let total = 0;
    for (const state of this.sources.values()) total += state.buffer.length;
    return total;
  }

  on(
    event: 'connect' | 'disconnect' | 'connect_error',
    listener: (...args: unknown[]) => void,
  ): void {
    this.socket.on(event, listener);
  }

  start(): void {
    this.flushTimer ??= setInterval(() => this.flush(), INGEST_BATCH_INTERVAL_MS);
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.socket.disconnect();
  }

  /** Queue one sample; the oldest buffered samples are dropped (and counted) beyond the cap. */
  enqueue(sourceId: string, event: TelemetryEvent): void {
    const state = this.stateFor(sourceId);
    state.buffer.push(event);
    const overflow = state.buffer.length - MAX_BUFFER_PER_SOURCE;
    if (overflow > 0) {
      state.buffer.splice(0, overflow);
      this.stats.dropped += overflow;
    }
  }

  /** Sends one batch per eligible source. Called every INGEST_BATCH_INTERVAL_MS. */
  flush(): void {
    if (!this.socket.connected) return;
    const now = this.now();
    for (const [sourceId, state] of this.sources) {
      if (state.inFlight || state.buffer.length === 0 || now < state.pausedUntil) continue;
      void this.sendBatch(sourceId, state);
    }
  }

  private async sendBatch(sourceId: string, state: SourceState): Promise<void> {
    const batch = state.buffer.slice(0, MAX_EVENTS_PER_BATCH);
    const lastSeq = batch[batch.length - 1]!.seq;
    const events = this.options.chaos.apply(sourceId, batch);
    state.inFlight = true;
    this.stats.eventsSent += events.length;
    try {
      const raw: unknown = await this.socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(INGEST_BATCH, { sourceId, events });
      this.handleAck(state, raw, lastSeq);
    } catch {
      // Timeout or disconnect mid-flight: keep the events and retry with the next batch.
      this.stats.ackTimeouts++;
    } finally {
      state.inFlight = false;
    }
  }

  private handleAck(state: SourceState, raw: unknown, lastSeq: number): void {
    const ack = IngestAck.safeParse(raw);
    if (!ack.success || !ack.data.ok) {
      this.stats.acksRejected++;
      const retryAfterMs = ack.success ? ack.data.retryAfterMs : undefined;
      state.pausedUntil = this.now() + (retryAfterMs ?? DEFAULT_RETRY_MS);
      return; // keep the events; they are retried once the pause ends
    }
    this.stats.acksOk++;
    this.stats.accepted += ack.data.accepted;
    this.stats.duplicates += ack.data.duplicates;
    this.stats.rejected += ack.data.rejected;
    if (ack.data.retryAfterMs) state.pausedUntil = this.now() + ack.data.retryAfterMs;
    // Buffer is seq-ordered; drop everything up to and including the acknowledged batch.
    const firstUnsent = state.buffer.findIndex((e) => e.seq > lastSeq);
    state.buffer.splice(0, firstUnsent === -1 ? state.buffer.length : firstUnsent);
  }

  private stateFor(sourceId: string): SourceState {
    let state = this.sources.get(sourceId);
    if (!state) {
      state = { buffer: [], pausedUntil: 0, inFlight: false };
      this.sources.set(sourceId, state);
    }
    return state;
  }
}
