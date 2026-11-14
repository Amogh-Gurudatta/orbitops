// /telemetry (JWT): clients subscribe to fleet / group / sat / system rooms and receive a snapshot,
// then deltas from the broadcaster. Also hosts NTP-style time sync and client latency reports.
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import {
  LATENCY_REPORT,
  parseRoom,
  SERVER_STATS,
  TIME_SYNC,
  TM_SNAPSHOT,
  SYSTEM_ROOM,
  type ParsedRoom,
  type TmSnapshot,
} from '@orbitops/shared';
import { userSocketAuth } from '../auth/socketAuth.js';
import type { TokenService } from '../auth/tokens.js';
import type { StatsCollector } from '../metrics/collector.js';
import type { StateStore } from '../state/store.js';
import type { ClientRegistry, TelemetryClient } from './clients.js';
import { attachSubscriptionHandlers, joinedRooms } from './subscriptions.js';

const LatencyPayload = z.strictObject({
  p50: z.number().min(0).max(1e6),
  p95: z.number().min(0).max(1e6),
  p99: z.number().min(0).max(1e6),
  n: z.int().min(1).max(1e6),
});

export interface TelemetryNamespaceDeps {
  tokens: TokenService;
  state: StateStore;
  registry: ClientRegistry;
  stats: StatsCollector;
}

const allowsTelemetryRoom = (room: ParsedRoom): boolean =>
  room.kind === 'fleet' || room.kind === 'sat' || room.kind === 'group' || room.kind === 'system';

function snapshotsFor(state: StateStore, rooms: ParsedRoom[]): TmSnapshot[] {
  const byId = new Map<number, TmSnapshot>();
  const add = (snaps: TmSnapshot[]) => snaps.forEach((s) => byId.set(s.s, s));
  for (const room of rooms) {
    if (room.kind === 'fleet') add(state.snapshots());
    else if (room.kind === 'group') add(state.snapshots(state.satIdsInGroup(room.group)));
    else if (room.kind === 'sat') add(state.snapshots([room.satId]));
  }
  return [...byId.values()];
}

function syncSatRooms(client: TelemetryClient): void {
  client.sats.clear();
  for (const name of joinedRooms(client.socket)) {
    const match = /^sat:(\d+)$/.exec(name);
    if (match) client.sats.add(Number(match[1]));
  }
}

export function registerTelemetryNamespace(nsp: Namespace, deps: TelemetryNamespaceDeps): void {
  const { state, registry, stats } = deps;
  nsp.use(userSocketAuth(deps.tokens));

  nsp.on('connection', (socket: Socket) => {
    const client = registry.add(socket);
    // Volatile frames are never replayed on recovery, so a recovered client is resynced with snapshots.
    if (socket.recovered) {
      syncSatRooms(client);
      const rooms = joinedRooms(socket).flatMap((name) => parseTelemetryRoom(name));
      const snaps = snapshotsFor(state, rooms);
      if (snaps.length > 0) socket.emit(TM_SNAPSHOT, snaps);
    }

    attachSubscriptionHandlers(socket, {
      allows: allowsTelemetryRoom,
      onSubscribed(requested, request) {
        if (request.hz !== undefined) registry.setHz(client, request.hz);
        syncSatRooms(client);
        const snaps = snapshotsFor(
          state,
          requested.map((r) => r.room),
        );
        if (snaps.length > 0) socket.emit(TM_SNAPSHOT, snaps);
        if (requested.some((r) => r.name === SYSTEM_ROOM))
          socket.emit(SERVER_STATS, stats.snapshot());
      },
      onUnsubscribed() {
        syncSatRooms(client);
      },
    });

    socket.on(TIME_SYNC, (_clientTs: unknown, ack?: unknown) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on(LATENCY_REPORT, (payload: unknown) => {
      const report = LatencyPayload.safeParse(payload);
      if (report.success) stats.recordLatency(socket.id, report.data);
    });

    socket.on('disconnect', () => {
      registry.remove(socket.id);
      stats.forgetClient(socket.id);
    });
  });
}

function parseTelemetryRoom(name: string): ParsedRoom[] {
  const room = parseRoom(name);
  return room && allowsTelemetryRoom(room) ? [room] : [];
}
