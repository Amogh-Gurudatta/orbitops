// Web Worker that owns BOTH Socket.IO connections (/telemetry and /alerts) so msgpack decoding,
// delta merging, dedup and latency accounting never touch the UI thread. It posts at most one
// batched message every WORKER_BATCH_INTERVAL_MS, with sample columns as transferable Float64Arrays.
import * as Comlink from 'comlink';
import { io, type Socket } from 'socket.io-client';
import {
  ALERT,
  ALERT_UPDATE,
  LATENCY_REPORT,
  NS_ALERTS,
  NS_TELEMETRY,
  SERVER_STATS,
  SUB,
  TIME_SYNC,
  TM_DELTA,
  TM_SNAPSHOT,
  UNSUB,
  parseRoom,
  socketParser,
  type Alert,
  type TmDelta,
  type TmSnapshot,
} from '@orbitops/shared';
import {
  LATENCY_REPORT_INTERVAL_MS,
  LATENCY_WINDOW_SAMPLES,
  TIME_SYNC_INTERVAL_MS,
  WORKER_BATCH_INTERVAL_MS,
} from '../config.ts';
import { TelemetryAggregator } from './aggregator.ts';
import { ClockSync, LatencyWindow } from './latency.ts';
import type {
  ConnectionState,
  PipelineStats,
  SocketWorkerApi,
  TelemetryBatch,
  WorkerEvents,
  WorkerStats,
} from './protocol.ts';

type SubAck = { ok: boolean; error?: string };

const clock = new ClockSync();
const latencyWindow = new LatencyWindow(LATENCY_WINDOW_SAMPLES);
const aggregator = new TelemetryAggregator((sampleTs) =>
  latencyWindow.add(Date.now() + clock.offsetMs - sampleTs),
);

let events: WorkerEvents | null = null;
let telemetry: Socket | null = null;
let alerts: Socket | null = null;
let timers: ReturnType<typeof setInterval>[] = [];
let batchesPosted = 0;
/** Set when the server announces it is dropping us as a slow consumer ('kick' precedes the disconnect). */
let kicked = false;
const KICK_RECONNECT_MS = 2000;

/** Desired rooms and their rates; replayed on every (re)connect. */
const rooms = new Map<string, number>();

const isAlertRoom = (room: string) => room.startsWith('alerts:');

function openSocket(namespace: string): Socket {
  return io(`${self.location.origin}${namespace}`, {
    parser: socketParser,
    transports: ['websocket'],
    withCredentials: true,
    reconnectionDelayMax: 5000,
  });
}

function setConnection(state: ConnectionState): void {
  void events?.onConnection(state);
}

function emitSub(socket: Socket | null, roomList: string[], hz: number): void {
  if (!socket?.connected || roomList.length === 0) return;
  socket.emit(SUB, { rooms: roomList, hz }, (ack: SubAck) => {
    if (!ack?.ok) console.warn('[worker] subscribe rejected', roomList, ack?.error);
  });
}

function resubscribeAll(socket: Socket | null, wantAlerts: boolean): void {
  const byHz = new Map<number, string[]>();
  for (const [room, hz] of rooms) {
    if (isAlertRoom(room) !== wantAlerts) continue;
    byHz.set(hz, [...(byHz.get(hz) ?? []), room]);
  }
  for (const [hz, list] of byHz) emitSub(socket, list, hz);
}

function syncSampledSats(): void {
  const sats = new Set<number>();
  for (const room of rooms.keys()) {
    const parsed = parseRoom(room);
    if (parsed?.kind === 'sat') sats.add(parsed.satId);
  }
  aggregator.setSampledSats(sats);
}

function timeSync(): void {
  const t0 = Date.now();
  telemetry?.emit(TIME_SYNC, t0, (serverTs: number) => {
    if (typeof serverTs === 'number') clock.addSample(t0, serverTs, Date.now());
  });
}

function reportLatency(): void {
  const report = latencyWindow.drain();
  if (report.n === 0) return;
  telemetry?.emit(LATENCY_REPORT, report);
  void events?.onLatency({ ...report, offsetMs: clock.offsetMs });
}

function flushBatch(): void {
  const batch = aggregator.flush();
  if (!batch || !events) return;
  batchesPosted++;
  void events.onBatch(Comlink.transfer(batch, transferablesOf(batch)));
}

function transferablesOf(batch: TelemetryBatch): Transferable[] {
  return batch.samples.flatMap((chunk) => [chunk.t.buffer, chunk.values.buffer]);
}

function wireTelemetry(socket: Socket): void {
  socket.on('connect', () => {
    setConnection('live');
    resubscribeAll(socket, false);
    timeSync();
  });
  socket.on('disconnect', (reason) => {
    // 'io client disconnect' is our own disconnect(). 'io server disconnect' means the server dropped
    // the handshake (token expired) and will not retry; the main thread refreshes and reconnects.
    if (reason === 'io client disconnect') setConnection('offline');
    else if (reason === 'io server disconnect' && kicked) {
      // Dropped as a slow consumer: not an auth problem, so just come back after a pause.
      kicked = false;
      setConnection('reconnecting');
      setTimeout(() => socket.connect(), KICK_RECONNECT_MS);
    } else setConnection(reason === 'io server disconnect' ? 'unauthorized' : 'reconnecting');
  });
  socket.on('connect_error', () => {
    // An inactive socket will not retry by itself: the handshake was refused (expired token).
    setConnection(socket.active ? 'reconnecting' : 'unauthorized');
  });
  socket.on('kick', () => {
    kicked = true;
  });
  socket.on(TM_SNAPSHOT, (payload: TmSnapshot[]) => {
    if (Array.isArray(payload)) aggregator.ingestSnapshots(payload);
  });
  socket.on(TM_DELTA, (payload: TmDelta[]) => {
    if (Array.isArray(payload)) aggregator.ingestDeltas(payload);
  });
  socket.on(SERVER_STATS, (stats: PipelineStats) => void events?.onServerStats(stats));
}

function wireAlerts(socket: Socket): void {
  socket.on('connect', () => resubscribeAll(socket, true));
  socket.on(ALERT, (alert: Alert) => void events?.onAlert(alert, true));
  socket.on(ALERT_UPDATE, (alert: Alert) => void events?.onAlert(alert, false));
}

function teardown(): void {
  timers.forEach(clearInterval);
  timers = [];
  telemetry?.disconnect();
  alerts?.disconnect();
  telemetry = null;
  alerts = null;
}

const api: SocketWorkerApi = {
  async connect(handlers) {
    teardown();
    events = handlers;
    setConnection('connecting');
    telemetry = openSocket(NS_TELEMETRY);
    alerts = openSocket(NS_ALERTS);
    wireTelemetry(telemetry);
    wireAlerts(alerts);
    timers = [
      setInterval(flushBatch, WORKER_BATCH_INTERVAL_MS),
      setInterval(timeSync, TIME_SYNC_INTERVAL_MS),
      setInterval(reportLatency, LATENCY_REPORT_INTERVAL_MS),
    ];
  },

  async disconnect() {
    teardown();
    setConnection('offline');
  },

  async reconnect() {
    setConnection('connecting');
    telemetry?.disconnect().connect();
    alerts?.disconnect().connect();
  },

  async subscribe(roomList, hz) {
    for (const room of roomList) rooms.set(room, hz);
    syncSampledSats();
    emitSub(
      telemetry,
      roomList.filter((r) => !isAlertRoom(r)),
      hz,
    );
    emitSub(alerts, roomList.filter(isAlertRoom), hz);
  },

  async unsubscribe(roomList) {
    for (const room of roomList) rooms.delete(room);
    syncSampledSats();
    const telemetryRooms = roomList.filter((r) => !isAlertRoom(r));
    const alertRooms = roomList.filter(isAlertRoom);
    if (telemetryRooms.length > 0) telemetry?.emit(UNSUB, { rooms: telemetryRooms }, () => {});
    if (alertRooms.length > 0) alerts?.emit(UNSUB, { rooms: alertRooms }, () => {});
  },

  async setHistoryWatermark(satId, lastSeq) {
    aggregator.setWatermark(satId, lastSeq);
  },

  async getStats(): Promise<WorkerStats> {
    const { tracker } = aggregator;
    return {
      accepted: tracker.accepted,
      duplicates: tracker.duplicates,
      belowWatermark: tracker.belowWatermark,
      restarts: tracker.restarts,
      batchesPosted,
      rooms: [...rooms.keys()],
    };
  },
};

Comlink.expose(api);
