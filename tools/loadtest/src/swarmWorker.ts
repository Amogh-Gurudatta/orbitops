// Worker thread for the client swarm: owns a slice of the virtual viewers. Each one is a real Socket.IO
// client on /telemetry using the shared msgpack parser, so decode cost is part of what is measured.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import { NS_TELEMETRY, socketParser, SUB, TM_DELTA, type TmDelta } from '@orbitops/shared';
import { io, type Socket } from 'socket.io-client';
import { Histogram } from './histogram.js';
import {
  MEASURED_KINDS,
  type ClientSpec,
  type CollectReply,
  type ConnectReply,
  type FromWorker,
  type ToWorker,
  type WorkerConfig,
} from './swarmProtocol.js';

const KICK_EVENT = 'kick';
const SUB_TIMEOUT_MS = 30_000;

const config = workerData as WorkerConfig;
const port = parentPort!;

/** Counts every inbound packet's size at the Socket.IO parser, i.e. real payload bytes after the wire. */
let bytesIn = 0;
const countingParser = {
  ...socketParser,
  Decoder: class extends socketParser.Decoder {
    override add(chunk: unknown): void {
      bytesIn += chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk) ? chunk.byteLength : 0;
      super.add(chunk);
    }
  },
};

const newHistograms = () => ({
  fleet: new Histogram(),
  group: new Histogram(),
  sat: new Histogram(),
});
let latency = newHistograms();
let messages = 0;
let deltas = 0;
let kicks = 0;
let disconnects: Record<string, number> = {};
const stalledStats = { count: 0, kicks: 0, disconnects: {} as Record<string, number> };
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

const alive = new Set<Socket>();
const stalledSockets: { resume(): void }[] = [];

type PausableSocket = { pause(): void; resume(): void };

/** The raw TCP socket under the WebSocket transport (ws keeps it in `_socket`). */
function rawTcpSocket(socket: Socket): PausableSocket | undefined {
  const engine = socket.io.engine as unknown as {
    transport?: { ws?: { _socket?: PausableSocket } };
  };
  return engine.transport?.ws?._socket;
}

function connectClient(spec: ClientSpec, errors: Set<string>): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = io(`${config.url}${NS_TELEMETRY}`, {
      parser: countingParser,
      transports: ['websocket'],
      auth: { token: config.token },
      forceNew: true,
      reconnection: false,
    });
    const stalled = spec.kind === 'stalled';
    if (stalled) stalledStats.count++;
    let settled = false;
    const settle = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      if (!ok && reason) errors.add(reason);
      resolve(ok);
    };

    socket.on('connect_error', (err) => settle(false, `connect_error: ${err.message}`));
    socket.on('connect', () => {
      socket
        .timeout(SUB_TIMEOUT_MS)
        .emitWithAck(SUB, { rooms: spec.rooms, ...(spec.hz ? { hz: spec.hz } : {}) })
        .then((ack: { ok: boolean; error?: string }) => {
          if (!ack.ok) return settle(false, `sub rejected: ${ack.error}`);
          alive.add(socket);
          if (stalled) stopReading(socket);
          settle(true);
        })
        .catch(() => settle(false, 'sub timeout'));
    });
    socket.on(TM_DELTA, (batch: TmDelta[]) => {
      if (stalled) return;
      const now = Date.now();
      messages++;
      deltas += batch.length;
      const histogram = latency[spec.kind as (typeof MEASURED_KINDS)[number]];
      for (const delta of batch) histogram.record(now - delta.t);
    });
    socket.on(KICK_EVENT, () => {
      if (stalled) stalledStats.kicks++;
      else kicks++;
    });
    socket.on('disconnect', (reason) => {
      alive.delete(socket);
      const bucket = stalled ? stalledStats.disconnects : disconnects;
      bucket[reason] = (bucket[reason] ?? 0) + 1;
    });
  });
}

/**
 * A hung client must not hang up on itself: engine.io-client closes the connection after 45 s without a
 * server ping, which would end the stall from the client side before the server's backpressure reacts.
 */
function disableClientHeartbeatWatchdog(socket: Socket): void {
  const engine = socket.io.engine as unknown as {
    _pingTimeoutTimer?: NodeJS.Timeout;
    _resetPingTimeout: () => void;
  };
  clearTimeout(engine._pingTimeoutTimer);
  engine._resetPingTimeout = () => undefined;
}

/** Stops draining the TCP socket so the server's send buffers for this client fill up. */
function stopReading(socket: Socket): void {
  const tcp = rawTcpSocket(socket);
  if (!tcp) return;
  disableClientHeartbeatWatchdog(socket);
  tcp.pause();
  stalledSockets.push(tcp);
}

async function connectAll(specs: ClientSpec[], rampPerSec: number): Promise<ConnectReply> {
  const errors = new Set<string>();
  const results: Promise<boolean>[] = [];
  const chunk = Math.max(1, Math.ceil(rampPerSec / 20));
  for (let i = 0; i < specs.length; i += chunk) {
    for (const spec of specs.slice(i, i + chunk)) results.push(connectClient(spec, errors));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const outcomes = await Promise.all(results);
  const connected = outcomes.filter(Boolean).length;
  return { connected, failed: outcomes.length - connected, errors: [...errors].slice(0, 5) };
}

function collect(): CollectReply {
  return {
    messages,
    deltas,
    bytes: bytesIn,
    connectedNow: alive.size,
    disconnects,
    kicks,
    stalled: stalledStats,
    latency: Object.fromEntries(
      MEASURED_KINDS.map((k) => [k, latency[k].snapshot()]),
    ) as CollectReply['latency'],
    loopP99Ms: loopDelay.count === 0 ? 0 : loopDelay.percentile(99) / 1e6,
  };
}

function reset(): void {
  latency = newHistograms();
  messages = deltas = kicks = bytesIn = 0;
  disconnects = {};
  loopDelay.reset();
}

const send = (message: FromWorker): void => port.postMessage(message);

port.on('message', (message: ToWorker) => {
  switch (message.type) {
    case 'connect':
      void connectAll(message.specs, message.rampPerSec).then((reply) =>
        send({ id: message.id, type: 'connected', reply }),
      );
      break;
    case 'reset':
      reset();
      send({ id: message.id, type: 'done' });
      break;
    case 'collect':
      send({ id: message.id, type: 'collected', reply: collect() });
      break;
    case 'resumeStalled':
      stalledSockets.forEach((tcp) => tcp.resume());
      send({ id: message.id, type: 'done' });
      break;
    case 'close':
      alive.forEach((socket) => socket.disconnect());
      send({ id: message.id, type: 'done' });
      break;
  }
});
