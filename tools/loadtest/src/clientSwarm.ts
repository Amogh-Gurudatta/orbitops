// Client swarm: C virtual viewers spread over worker threads. Each logs in with a shared token, connects to
// /telemetry (websocket only, msgpack parser) and subscribes according to a configurable mix. Workers count
// messages, bytes and end-to-end latency (receive time minus the sample timestamp `delta.t`; the generator
// and the clients share one machine and clock). The coordinator merges the workers' results.
import { Worker } from 'node:worker_threads';
import { satRoom, groupRoom, SAT_GROUPS, FLEET_ROOM } from '@orbitops/shared';
import { catalogueSatIds, login } from './api.js';
import { numberFlag, parseFlags, stringFlag } from './args.js';
import { Histogram, type LatencySummary } from './histogram.js';
import {
  MEASURED_KINDS,
  type ClientSpec,
  type CollectReply,
  type ConnectReply,
  type FromWorker,
  type ToWorker,
  type WorkerConfig,
} from './swarmProtocol.js';

/** Fractions per subscription kind, e.g. `fleet:70,group:20,sat:10`. */
export type Mix = Record<'fleet' | 'group' | 'sat', number>;
export const DEFAULT_MIX: Mix = { fleet: 70, group: 20, sat: 10 };

export function parseMix(text: string): Mix {
  const mix: Mix = { fleet: 0, group: 0, sat: 0 };
  for (const part of text.split(',')) {
    const [kind, share] = part.split(':');
    if (kind !== 'fleet' && kind !== 'group' && kind !== 'sat')
      throw new Error(`bad mix kind "${kind}"`);
    mix[kind] = Number(share);
  }
  return mix;
}

/** Deterministically assigns `count` clients to subscription kinds in the requested proportions. */
export function buildSpecs(count: number, mix: Mix, satIds: number[], stalled = 0): ClientSpec[] {
  const total = mix.fleet + mix.group + mix.sat;
  const specs: ClientSpec[] = [];
  for (let i = 0; i < count; i++) {
    const slot = ((i * 100) / count) % 100; // spreads kinds evenly across the index range
    const share = (slot / 100) * total;
    if (share < mix.fleet) specs.push({ kind: 'fleet', rooms: [FLEET_ROOM] });
    else if (share < mix.fleet + mix.group) {
      specs.push({ kind: 'group', rooms: [groupRoom(SAT_GROUPS[i % SAT_GROUPS.length]!)] });
    } else {
      specs.push({ kind: 'sat', rooms: [satRoom(satIds[i % satIds.length]!)], hz: 10 });
    }
  }
  // A stalled client subscribes to everything it can so the server has plenty to send it.
  for (let i = 0; i < stalled; i++) {
    const rooms = [FLEET_ROOM, ...SAT_GROUPS.map(groupRoom), ...satIds.slice(0, 40).map(satRoom)];
    specs.push({ kind: 'stalled', rooms, hz: 10 });
  }
  return specs;
}

export interface SwarmResult {
  durationS: number;
  connectedAtEnd: number;
  messages: number;
  messagesPerSec: number;
  deltasPerSec: number;
  bytesPerSec: number;
  latency: Record<'all' | (typeof MEASURED_KINDS)[number], LatencySummary>;
  disconnects: Record<string, number>;
  kicks: number;
  /** Highest per-worker event-loop p99 (ms): a hint that the load generator itself was saturated. */
  workerLoopP99Ms: number;
  stalled: CollectReply['stalled'];
}

export interface ConnectSummary extends ConnectReply {
  requested: number;
  connectSeconds: number;
}

export class ClientSwarm {
  private readonly workers: Worker[];
  private nextId = 1;
  private measureStartedAt = 0;

  constructor(config: WorkerConfig, workerCount: number) {
    this.workers = Array.from(
      { length: workerCount },
      () => new Worker(new URL('./swarmWorker.ts', import.meta.url), { workerData: config }),
    );
  }

  /** Connects every spec, spreading them round-robin over the workers at `rampPerSec` overall. */
  async connect(specs: ClientSpec[], rampPerSec: number): Promise<ConnectSummary> {
    const startedAt = performance.now();
    const slices = this.workers.map(() => [] as ClientSpec[]);
    specs.forEach((spec, i) => slices[i % slices.length]!.push(spec));
    const replies = await Promise.all(
      this.workers.map((worker, i) =>
        this.call(worker, {
          type: 'connect',
          specs: slices[i]!,
          rampPerSec: rampPerSec / this.workers.length,
        }),
      ),
    );
    const summary: ConnectSummary = {
      requested: specs.length,
      connected: 0,
      failed: 0,
      errors: [],
      connectSeconds: Math.round(((performance.now() - startedAt) / 1000) * 10) / 10,
    };
    for (const message of replies) {
      if (message.type !== 'connected') continue;
      summary.connected += message.reply.connected;
      summary.failed += message.reply.failed;
      summary.errors.push(...message.reply.errors);
    }
    summary.errors = [...new Set(summary.errors)].slice(0, 5);
    return summary;
  }

  async beginMeasure(): Promise<void> {
    await Promise.all(this.workers.map((w) => this.call(w, { type: 'reset' })));
    this.measureStartedAt = performance.now();
  }

  async endMeasure(): Promise<SwarmResult> {
    const durationS = (performance.now() - this.measureStartedAt) / 1000;
    const replies = await Promise.all(this.workers.map((w) => this.call(w, { type: 'collect' })));
    const merged = new Map(MEASURED_KINDS.map((k) => [k, new Histogram()]));
    const all = new Histogram();
    const result = {
      messages: 0,
      deltas: 0,
      bytes: 0,
      connectedAtEnd: 0,
      kicks: 0,
      workerLoopP99Ms: 0,
      disconnects: {} as Record<string, number>,
      stalled: { count: 0, kicks: 0, disconnects: {} as Record<string, number> },
    };
    for (const message of replies) {
      if (message.type !== 'collected') continue;
      const r = message.reply;
      result.messages += r.messages;
      result.deltas += r.deltas;
      result.bytes += r.bytes;
      result.connectedAtEnd += r.connectedNow;
      result.kicks += r.kicks;
      result.workerLoopP99Ms = Math.max(result.workerLoopP99Ms, r.loopP99Ms);
      addCounts(result.disconnects, r.disconnects);
      result.stalled.count += r.stalled.count;
      result.stalled.kicks += r.stalled.kicks;
      addCounts(result.stalled.disconnects, r.stalled.disconnects);
      for (const kind of MEASURED_KINDS) {
        merged.get(kind)!.merge(r.latency[kind]);
        all.merge(r.latency[kind]);
      }
    }
    const per = (n: number) => Math.round(n / durationS);
    return {
      durationS: Math.round(durationS * 10) / 10,
      connectedAtEnd: result.connectedAtEnd,
      messages: result.messages,
      messagesPerSec: per(result.messages),
      deltasPerSec: per(result.deltas),
      bytesPerSec: per(result.bytes),
      latency: {
        all: all.summary(),
        fleet: merged.get('fleet')!.summary(),
        group: merged.get('group')!.summary(),
        sat: merged.get('sat')!.summary(),
      },
      disconnects: result.disconnects,
      kicks: result.kicks,
      workerLoopP99Ms: Math.round(result.workerLoopP99Ms * 10) / 10,
      stalled: result.stalled,
    };
  }

  async resumeStalled(): Promise<void> {
    await Promise.all(this.workers.map((w) => this.call(w, { type: 'resumeStalled' })));
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => this.call(w, { type: 'close' })));
    await Promise.all(this.workers.map((w) => w.terminate()));
  }

  private call(worker: Worker, request: DistributiveOmit<ToWorker, 'id'>): Promise<FromWorker> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onMessage = (message: FromWorker) => {
        if (message.id !== id) return;
        worker.off('message', onMessage);
        resolve(message);
      };
      worker.on('message', onMessage);
      worker.once('error', reject);
      worker.postMessage({ ...request, id });
    });
  }
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function addCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value;
}

if (import.meta.main) {
  const flags = parseFlags();
  const url = stringFlag(flags, 'url', 'http://localhost:4000');
  const clients = numberFlag(flags, 'clients', 100);
  const durationS = numberFlag(flags, 'duration', 30);
  const token = await login(url);
  const satIds = await catalogueSatIds();
  const swarm = new ClientSwarm({ url, token }, numberFlag(flags, 'workers', 4));
  const specs = buildSpecs(
    clients,
    parseMix(stringFlag(flags, 'mix', 'fleet:70,group:20,sat:10')),
    satIds,
  );
  const connect = await swarm.connect(specs, numberFlag(flags, 'ramp', 500));
  console.log(JSON.stringify({ connect }));
  await swarm.beginMeasure();
  await new Promise((resolve) => setTimeout(resolve, durationS * 1000));
  console.log(JSON.stringify(await swarm.endMeasure(), null, 2));
  await swarm.close();
}
