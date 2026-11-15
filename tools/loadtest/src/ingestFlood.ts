// Ingest flood: simulates satellites pushing telemetry to /ingest at a configurable rate and measures what
// the server acknowledges, what it rate-limits, and how long acks take.
//
// Each source (sat-<noradId>) is a virtual satellite whose samples are generated on a virtual clock at `hz`.
// One batch per source is in flight at a time, like the real simulator transport. The server only accepts
// sources in its satellite catalogue (65 seeded), so load beyond that is scaled with `hz`, not more sources.
import {
  IngestAck,
  INGEST_BATCH,
  MAX_EVENTS_PER_BATCH,
  NS_INGEST,
  socketParser,
  sourceIdFromSatId,
  type TelemetryEvent,
} from '@orbitops/shared';
import { io, type Socket } from 'socket.io-client';
import { catalogueSatIds, DEV_DEVICE_KEY } from './api.js';
import { numberFlag, parseFlags, stringFlag } from './args.js';
import { makeFrame } from './frames.js';
import { Histogram, type LatencySummary } from './histogram.js';

const ACK_TIMEOUT_MS = 5_000;
const SEQ_PER_MS = 10;
export const MAX_HZ = 5_000;
/** A source that falls this far behind its virtual clock skips ahead (its backlog is counted as dropped). */
const MAX_LAG_MS = 2_000;

export interface FloodOptions {
  url: string;
  apiKey: string;
  /** Number of virtual satellites (capped by the catalogue size). */
  sources: number;
  /** Samples per second per source (1..5000; above 1000 several samples share a millisecond timestamp). */
  hz: number;
  durationS: number;
  batchMs: number;
  /** Socket.IO connections the sources are spread over. */
  sockets: number;
  /** Pause a source for the server's retryAfterMs after a rejection (what the real simulator does). */
  honorBackoff: boolean;
}

export interface FloodResult {
  options: Omit<FloodOptions, 'apiKey'>;
  offeredEventsPerSec: number;
  sentEvents: number;
  acceptedEvents: number;
  duplicateEvents: number;
  /** Events the server dropped as malformed inside otherwise accepted batches. */
  malformedEvents: number;
  /** Events in batches refused with ok:false (rate limited). */
  rejectedEvents: number;
  acksOk: number;
  acksRejected: number;
  ackTimeouts: number;
  /** Acks that carried a retryAfterMs hint, and the largest hint seen. */
  retryAfterHints: number;
  retryAfterMaxMs: number;
  /** Events skipped locally because a source could not keep up with its virtual clock. */
  droppedLocally: number;
  ackedEventsPerSec: number;
  ackLatency: LatencySummary;
}

interface Source {
  sourceId: string;
  index: number;
  period: number;
  nextTs: number;
  seq: number;
  inFlight: boolean;
  pausedUntil: number;
}

class Flood {
  private readonly latency = new Histogram();
  private readonly totals = {
    sent: 0,
    accepted: 0,
    duplicates: 0,
    malformed: 0,
    rejected: 0,
    acksOk: 0,
    acksRejected: 0,
    timeouts: 0,
    hints: 0,
    hintMaxMs: 0,
    droppedLocally: 0,
  };
  private running = false;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly options: FloodOptions) {}

  async run(satIds: number[]): Promise<FloodResult> {
    const { options } = this;
    const sourceCount = Math.min(options.sources, satIds.length);
    const sockets = await this.connectSockets(Math.min(options.sockets, sourceCount));
    // seq is seeded from the wall clock at 10 per ms: it grows at least as fast as any source can emit
    // (<= 5000/s), so a later run never reuses seqs the server already holds for the same satellite.
    const startMs = Date.now();
    // Random phase per source so batches do not all land in the same millisecond. The virtual clock starts at
    // the same phase, so at low rates each sample is sent at (not before) its own timestamp.
    const phases = satIds.slice(0, sourceCount).map(() => Math.random() * options.batchMs);
    const sources: Source[] = satIds.slice(0, sourceCount).map((satId, index) => ({
      sourceId: sourceIdFromSatId(satId),
      index,
      period: 1000 / options.hz,
      nextTs: startMs + phases[index]!,
      seq: startMs * SEQ_PER_MS,
      inFlight: false,
      pausedUntil: 0,
    }));

    this.running = true;
    sources.forEach((source, i) => {
      const socket = sockets[i % sockets.length]!;
      const phase = setTimeout(() => {
        this.timers.push(setInterval(() => this.tick(socket, source), options.batchMs));
      }, phases[i]);
      this.timers.push(phase);
    });

    await new Promise((resolve) => setTimeout(resolve, options.durationS * 1000));
    this.running = false;
    this.timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    await Promise.allSettled([...this.pending]);
    sockets.forEach((s) => s.disconnect());
    return this.result(sourceCount);
  }

  private async connectSockets(count: number): Promise<Socket[]> {
    const sockets = Array.from({ length: count }, () =>
      io(`${this.options.url}${NS_INGEST}`, {
        parser: socketParser,
        transports: ['websocket'],
        auth: { apiKey: this.options.apiKey },
        forceNew: true,
        reconnection: false,
      }),
    );
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', (err) =>
              reject(new Error(`ingest connect: ${err.message}`)),
            );
          }),
      ),
    );
    return sockets;
  }

  private tick(socket: Socket, source: Source): void {
    const now = Date.now();
    if (!this.running || source.inFlight || now < source.pausedUntil) return;
    const events = this.takeDue(source, now);
    if (events.length === 0) return;
    source.inFlight = true;
    const job = this.send(socket, source, events).finally(() => {
      source.inFlight = false;
      this.pending.delete(job);
    });
    this.pending.add(job);
  }

  /** Samples whose virtual timestamp has passed, oldest first, at most one batch worth. */
  private takeDue(source: Source, now: number): TelemetryEvent[] {
    if (now - source.nextTs > MAX_LAG_MS) {
      const skipped = Math.floor((now - MAX_LAG_MS - source.nextTs) / source.period);
      source.nextTs += skipped * source.period;
      source.seq += skipped;
      this.totals.droppedLocally += skipped;
    }
    const events: TelemetryEvent[] = [];
    while (source.nextTs <= now && events.length < MAX_EVENTS_PER_BATCH) {
      const ts = Math.round(source.nextTs);
      events.push({ seq: source.seq++, ts, type: 'tm', data: makeFrame(source.index, ts) });
      source.nextTs += source.period;
    }
    return events;
  }

  private async send(socket: Socket, source: Source, events: TelemetryEvent[]): Promise<void> {
    const { totals } = this;
    totals.sent += events.length;
    const startedAt = performance.now();
    try {
      const raw: unknown = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(INGEST_BATCH, { sourceId: source.sourceId, events });
      this.latency.record(performance.now() - startedAt);
      this.handleAck(source, raw, events.length);
    } catch {
      totals.timeouts++;
    }
  }

  private handleAck(source: Source, raw: unknown, batchSize: number): void {
    const { totals } = this;
    const parsed = IngestAck.safeParse(raw);
    if (!parsed.success) return;
    const ack = parsed.data;
    if (ack.ok) {
      totals.acksOk++;
      totals.accepted += ack.accepted;
      totals.duplicates += ack.duplicates;
      totals.malformed += ack.rejected;
    } else {
      totals.acksRejected++;
      totals.rejected += batchSize;
    }
    if (ack.retryAfterMs) {
      totals.hints++;
      totals.hintMaxMs = Math.max(totals.hintMaxMs, ack.retryAfterMs);
      if (this.options.honorBackoff) source.pausedUntil = Date.now() + ack.retryAfterMs;
    }
  }

  private result(sourceCount: number): FloodResult {
    const { options, totals } = this;
    return {
      options: {
        url: options.url,
        sources: sourceCount,
        hz: options.hz,
        durationS: options.durationS,
        batchMs: options.batchMs,
        sockets: options.sockets,
        honorBackoff: options.honorBackoff,
      },
      offeredEventsPerSec: sourceCount * options.hz,
      sentEvents: totals.sent,
      acceptedEvents: totals.accepted,
      duplicateEvents: totals.duplicates,
      malformedEvents: totals.malformed,
      rejectedEvents: totals.rejected,
      acksOk: totals.acksOk,
      acksRejected: totals.acksRejected,
      ackTimeouts: totals.timeouts,
      retryAfterHints: totals.hints,
      retryAfterMaxMs: totals.hintMaxMs,
      droppedLocally: totals.droppedLocally,
      ackedEventsPerSec: Math.round(totals.accepted / options.durationS),
      ackLatency: this.latency.summary(),
    };
  }
}

export async function runIngestFlood(options: FloodOptions): Promise<FloodResult> {
  return new Flood(options).run(await catalogueSatIds());
}

if (import.meta.main) {
  const flags = parseFlags();
  const hz = numberFlag(flags, 'hz', 10);
  if (hz < 1 || hz > MAX_HZ) throw new Error(`--hz must be between 1 and ${MAX_HZ}`);
  const result = await runIngestFlood({
    url: stringFlag(flags, 'url', 'http://localhost:4000'),
    apiKey: stringFlag(flags, 'key', DEV_DEVICE_KEY),
    sources: numberFlag(flags, 'sources', 64),
    hz,
    durationS: numberFlag(flags, 'duration', 30),
    batchMs: numberFlag(flags, 'batch-ms', 100),
    sockets: numberFlag(flags, 'sockets', 4),
    honorBackoff: flags['ignore-backoff'] !== true,
  });
  console.log(JSON.stringify(result, null, 2));
}
