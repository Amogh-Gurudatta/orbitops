import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Command,
  IngestBatch,
  socketParser,
  type IngestAck,
  type TelemetryEvent,
} from '@orbitops/shared';
import { Server, type Socket } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chaos } from './chaos.js';
import { IngestTransport, MAX_BUFFER_PER_SOURCE } from './transport.js';

type Ack = (ack: IngestAck) => void;

function makeEvent(seq: number): TelemetryEvent {
  return {
    seq,
    ts: 1_700_000_000_000,
    type: 'tm',
    data: {
      lat: 10,
      lon: 20,
      altKm: 400,
      velKms: 7.6,
      shadow: 0,
      solarW: 300,
      batSoc: 0.8,
      batV: 28,
      busA: 3,
      panelTempC: 40,
      obcTempC: 25,
      rssiDbm: null,
      snrDb: null,
      stationId: null,
      elevDeg: null,
      attRateDps: 0.05,
      propKg: 10,
      mode: 'NOMINAL',
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}

describe('IngestTransport', () => {
  let http: HttpServer;
  let io: Server;
  let serverSocket: Socket | undefined;
  let url: string;
  let handler: (payload: unknown, ack: Ack) => void;
  let authSeen: unknown;
  let transport: IngestTransport | undefined;
  const received: { at: number; payload: unknown }[] = [];
  const chaos = new Chaos();
  const commands: Command[] = [];

  beforeEach(async () => {
    received.length = 0;
    commands.length = 0;
    serverSocket = undefined;
    handler = (_payload, ack) => ack({ ok: true, accepted: 1, duplicates: 0, rejected: 0 });
    http = createServer();
    io = new Server(http, { parser: socketParser as never });
    io.of('/ingest').on('connection', (socket) => {
      authSeen = socket.handshake.auth;
      serverSocket = socket;
      socket.on('batch', (payload: unknown, ack: Ack) => {
        received.push({ at: Date.now(), payload });
        handler(payload, ack);
      });
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    transport?.stop();
    transport = undefined;
    await io.close();
  });

  function connect(): IngestTransport {
    transport = new IngestTransport({
      serverUrl: url,
      apiKey: 'secret',
      chaos,
      onCommand: (c) => commands.push(c),
    });
    transport.start();
    return transport;
  }

  it('sends valid per-source batches over the msgpack parser with the API key and drains the buffer', async () => {
    const t = connect();
    for (let seq = 1; seq <= 5; seq++) t.enqueue('sat-25544', makeEvent(seq));
    t.enqueue('sat-48274', makeEvent(1));
    await until(() => t.stats.acksOk >= 2 && t.buffered === 0);

    expect(authSeen).toEqual({ apiKey: 'secret' });
    const batches = received.map((r) => IngestBatch.parse(r.payload));
    expect(new Set(batches.map((b) => b.sourceId))).toEqual(new Set(['sat-25544', 'sat-48274']));
    const seqs = batches
      .filter((b) => b.sourceId === 'sat-25544')
      .flatMap((b) => b.events.map((e) => e.seq));
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it('honours ok:false + retryAfterMs by pausing that source, keeping and then resending its events', async () => {
    let first = true;
    handler = (_payload, ack) => {
      if (first) {
        first = false;
        ack({ ok: false, accepted: 0, duplicates: 0, rejected: 0, retryAfterMs: 600 });
      } else {
        ack({ ok: true, accepted: 1, duplicates: 0, rejected: 0 });
      }
    };
    const t = connect();
    t.enqueue('sat-1', makeEvent(1));
    await until(() => received.length === 1);
    await until(() => t.stats.acksRejected === 1);
    t.enqueue('sat-1', makeEvent(2)); // keeps arriving while paused
    await sleep(350);
    expect(received.length).toBe(1); // still paused
    expect(t.buffered).toBe(2);

    await until(() => t.buffered === 0);
    expect(received.length).toBe(2);
    expect(received[1]!.at - received[0]!.at).toBeGreaterThanOrEqual(550);
    expect(IngestBatch.parse(received[1]!.payload).events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('does not pause other sources while one is backed off', async () => {
    handler = (payload, ack) => {
      const { sourceId } = payload as { sourceId: string };
      ack(
        sourceId === 'sat-1'
          ? { ok: false, accepted: 0, duplicates: 0, rejected: 0, retryAfterMs: 5000 }
          : { ok: true, accepted: 1, duplicates: 0, rejected: 0 },
      );
    };
    const t = connect();
    t.enqueue('sat-1', makeEvent(1));
    await until(() => t.stats.acksRejected === 1);
    t.enqueue('sat-2', makeEvent(1));
    await until(() => t.stats.acksOk === 1);
    expect(t.buffered).toBe(1);
  });

  it('keeps events when an ack times out and retries them', async () => {
    let calls = 0;
    handler = (_payload, ack) => {
      calls++;
      if (calls > 1) ack({ ok: true, accepted: 1, duplicates: 0, rejected: 0 });
      // first call: never acked -> client times out after 2 s
    };
    const t = connect();
    t.enqueue('sat-1', makeEvent(1));
    await until(() => t.buffered === 0, 6000);
    expect(t.stats.ackTimeouts).toBe(1);
    expect(calls).toBe(2);
  }, 10_000);

  it('bounds the per-source buffer, dropping the oldest and counting drops', () => {
    const t = new IngestTransport({
      serverUrl: 'http://127.0.0.1:1',
      apiKey: 'x',
      chaos,
      onCommand: () => {},
    });
    transport = t;
    for (let seq = 0; seq < MAX_BUFFER_PER_SOURCE + 50; seq++) t.enqueue('sat-1', makeEvent(seq));
    expect(t.buffered).toBe(MAX_BUFFER_PER_SOURCE);
    expect(t.stats.dropped).toBe(50);
  });

  it('forwards COMMAND events (validated) and applies chaos config from the server', async () => {
    const t = connect();
    await until(() => t.connected && serverSocket !== undefined);
    serverSocket!.emit('cmd', { satId: 25544, kind: 'inject_fault', fault: 'battery' });
    serverSocket!.emit('cmd', { satId: 1, kind: 'inject_fault' }); // invalid: no fault
    serverSocket!.emit('chaos', {
      enabled: true,
      duplicateRate: 0.1,
      reorderRate: 0.1,
      malformedRate: 0.1,
    });
    await until(() => commands.length === 1 && chaos.enabled);
    expect(commands[0]).toEqual({ satId: 25544, kind: 'inject_fault', fault: 'battery' });
    chaos.configure({ enabled: false, duplicateRate: 0, reorderRate: 0, malformedRate: 0 });
  });
});
